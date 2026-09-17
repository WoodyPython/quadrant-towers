import {
  adjacent,
  allCells,
  cellKey,
  inBounds,
  occupiedCell,
  ownsCell,
  PRESETS,
  QUADRANTS,
  quadrantCells,
  quadrantAt,
  towerAt,
} from './board.js';
import { generateOffer, pinnedContent, selectable } from './cards/registry.js';
import {
  fallbackTargets,
  isCell,
  neighbors,
  rectangle,
  validateTargets,
} from './cards/targets.js';
import { randomIndex, shuffle } from './random.js';
import { determineResult } from './scoring.js';
import type {
  AbilityCardDefinition,
  Action,
  ActiveEffect,
  Cell,
  Command,
  EffectDefinition,
  EngineRegistry,
  GameEvent,
  MatchState,
  ModifierKind,
  Player,
  PresetId,
  TargetValue,
  Tower,
  Transition,
  Trigger,
} from './types.js';

export const TURN_DURATION_MS = 90_000;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const playerById = (state: MatchState, id: string): Player =>
  state.players.find((p) => p.id === id)!;
function event(
  state: MatchState,
  playerId: string,
  type: GameEvent['type'],
  details: Record<string, unknown> = {},
) {
  state.history.push({
    sequence: state.history.length + 1,
    playerId,
    type,
    details,
  });
}
function reveal(state: MatchState, ownerId: string, cell: Cell) {
  const player = playerById(state, ownerId);
  const key = cellKey(cell);
  if (!player.revealed.includes(key)) player.revealed.push(key);
}
function getCard(
  state: MatchState,
  registry: EngineRegistry,
  id: string,
): AbilityCardDefinition {
  const card = pinnedContent(state, registry).catalog.cards.find(
    (c) => c.id === id,
  );
  requireRule(card, 'Unknown card');
  return card;
}
function expireEffects(
  state: MatchState,
  registry: EngineRegistry,
  endingTurn = false,
) {
  state.effects = state.effects.filter((effect) => {
    const owner = playerById(state, effect.ownerId);
    const card = getCard(state, registry, effect.cardId);
    const missingTarget = card.targets.some(
      (target) =>
        [
          'own_tower',
          'damaged_own_tower',
          'one_health_tower',
          'expandable_tower',
          'revealed_enemy_tower',
        ].includes(target.kind) &&
        !state.towers.some((t) => t.id === effect.targets[target.id]),
    );
    const expired =
      owner.eliminated ||
      missingTarget ||
      effect.remainingCharges === 0 ||
      (effect.expiresTurn !== null &&
        (state.turn.number > effect.expiresTurn ||
          (endingTurn && state.turn.number === effect.expiresTurn))) ||
      (effect.expiresOwnerTurn !== null &&
        owner.turnsStarted >= effect.expiresOwnerTurn) ||
      (effect.expiresRound !== null && state.turn.round >= effect.expiresRound);
    if (expired)
      event(state, effect.ownerId, 'effect_expired', {
        cardId: card.id,
        ...(effect.revealed ? { publicCardId: card.id } : {}),
      });
    return !expired;
  });
}
interface EffectContext {
  ownerId: string;
  targets: Record<string, TargetValue>;
  tower?: Tower;
  damage: number;
  registry?: EngineRegistry;
}
type EffectHandlers = {
  [K in EffectDefinition['type']]: (
    state: MatchState,
    effect: Extract<EffectDefinition, { type: K }>,
    context: EffectContext,
  ) => void;
};
// Adding a mechanic extends the discriminated schema and this exhaustive handler table.
const effectHandlers: EffectHandlers = {
  neutral: () => {},
  heal: (state, effect, context) => {
    const value = context.targets[effect.target];
    const towers =
      effect.target === 'event_tower'
        ? [context.tower]
        : state.towers.filter((t) =>
            Array.isArray(value)
              ? value.some((v) => v === t.id)
              : t.id === value,
          );
    for (const tower of towers)
      if (tower && tower.ownerId === context.ownerId && tower.health > 0)
        tower.health = Math.min(10, tower.health + effect.amount);
  },
  reveal: (state, effect, context) => {
    const value = context.targets[effect.target];
    let cells: Cell[] = [];
    if (effect.mode === 'quadrant' && typeof value === 'string') {
      const enemy = playerById(state, value);
      cells = quadrantCells(state.preset, enemy.quadrant);
    } else if (isCell(value)) {
      cells =
        effect.mode === 'rectangle'
          ? rectangle(value, effect.size!)
          : effect.mode === 'row_column'
            ? allCells(state.preset).filter(
                (c) =>
                  quadrantAt(state.preset, c) ===
                    quadrantAt(state.preset, value) &&
                  (c.x === value.x || c.y === value.y),
              )
            : [value];
      if (effect.mode === 'neighbors_if_occupied' && towerAt(state, value))
        cells.push(...neighbors(state, value));
    } else if (Array.isArray(value)) cells = value.filter(isCell);
    for (const cell of cells) reveal(state, context.ownerId, cell);
  },
  modifier: () => {},
  extra_actions: (state, effect) => {
    state.turn.actionsRemaining = Math.min(
      4,
      state.turn.actionsRemaining + effect.amount,
    );
  },
  heal_all: (state, effect, context) => {
    for (const t of state.towers)
      if (t.ownerId === context.ownerId)
        t.health = Math.min(10, t.health + effect.amount);
  },
  random_reveal: (state, effect, context) => {
    for (const p of state.players)
      if (p.id !== context.ownerId && !p.eliminated)
        randomReveal(state, context.ownerId, p.id, effect.amount);
  },
  build_free: (state, effect, context) => {
    const value = context.targets[effect.target];
    const cells = Array.isArray(value)
      ? value.filter(isCell)
      : isCell(value)
        ? [value]
        : [];
    for (const cell of cells) {
      performAction(state, context.registry!, { type: 'build', cell }, true);
      const tower = towerAt(state, cell)!;
      tower.health = Math.min(10, tower.health + effect.health - 1);
    }
  },
  expand_free: (state, effect, context) => {
    const value = context.targets[effect.cellsTarget];
    for (const cell of Array.isArray(value) ? value.filter(isCell) : [])
      performAction(
        state,
        context.registry!,
        {
          type: 'expand',
          towerId: context.targets[effect.target] as string,
          cell,
        },
        true,
      );
  },
  damage: (state, effect, context) => {
    const tower = state.towers.find(
      (t) => t.id === context.targets[effect.target],
    );
    if (tower)
      dealDamage(
        state,
        context.registry!,
        context.ownerId,
        tower,
        effect.amount,
        false,
      );
    eliminate(state, context.registry!);
  },
  area_damage: (state, effect, context) => {
    const anchor = context.targets[effect.target];
    if (!isCell(anchor)) return;
    const cells = rectangle(anchor, effect.size);
    for (const c of cells) reveal(state, context.ownerId, c);
    // Snapshot distinct victims; finish only after the entire atomic blast resolves.
    const victims = state.towers
      .filter((t) =>
        t.cells.some((c) => cells.some((x) => cellKey(c) === cellKey(x))),
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const t of victims)
      dealDamage(
        state,
        context.registry!,
        context.ownerId,
        t,
        effect.amount,
        false,
      );
    eliminate(state, context.registry!);
  },
  prevent_damage: (_state, effect, context) => {
    context.damage = Math.max(0, context.damage - effect.amount);
  },
};
function resolveEffect(
  state: MatchState,
  effect: EffectDefinition,
  context: EffectContext,
) {
  // The handler map is exhaustive; narrow the correlated discriminated argument here.
  const handler = effectHandlers[effect.type] as (
    state: MatchState,
    effect: EffectDefinition,
    context: EffectContext,
  ) => void;
  return handler(state, effect, context);
}
function trigger(
  state: MatchState,
  registry: EngineRegistry,
  triggerName: Trigger,
  context: EffectContext,
) {
  // Stable insertion order, then definition order. One charge per matching event.
  for (const active of [...state.effects]) {
    if (active.ownerId !== context.ownerId || active.remainingCharges === 0)
      continue;
    const card = getCard(state, registry, active.cardId);
    const effects = card.effects.filter((e) => e.trigger === triggerName);
    if (!effects.length) continue;
    active.revealed = true;
    const local = { ...context, targets: active.targets };
    for (const effect of effects) resolveEffect(state, effect, local);
    context.damage = local.damage;
    event(state, active.ownerId, 'effect_triggered', {
      cardId: card.id,
      publicCardId: card.id,
      trigger: triggerName,
    });
    if (card.lifecycle === 'consumable') active.remainingCharges = 0;
    else if (active.remainingCharges !== null) active.remainingCharges--;
  }
  expireEffects(state, registry);
}
function activate(
  state: MatchState,
  card: AbilityCardDefinition,
  targets: Record<string, TargetValue>,
) {
  if (!card.effects.some((e) => e.trigger !== 'on_selected')) return;
  const owner = playerById(state, state.turn.playerId);
  const duration = card.duration!;
  const shield = card.effects.find(
    (e): e is Extract<EffectDefinition, { type: 'modifier' }> =>
      e.type === 'modifier' && e.kind === 'shield',
  );
  const effect: ActiveEffect = {
    id: `effect-${state.nextId++}`,
    cardId: card.id,
    cardVersion: card.version,
    ownerId: owner.id,
    targets: clone(targets),
    revealed:
      card.visibility === 'public' ||
      card.effects.some((e) => e.trigger === 'on_selected'),
    remainingCharges: card.charges ?? null,
    expiresTurn: duration.type === 'this_turn' ? state.turn.number : null,
    expiresOwnerTurn:
      duration.type === 'until_owner_next_turn'
        ? owner.turnsStarted + 1
        : duration.type === 'owner_turns'
          ? owner.turnsStarted + duration.count
          : null,
    ...(shield ? { shieldRemaining: shield.amount } : {}),
    hitTowerIds: [],
    expiresRound:
      duration.type === 'rounds' ? state.turn.round + duration.count : null,
  };
  const existing = state.effects.find(
    (e) => e.ownerId === owner.id && e.cardId === card.id,
  );
  if (existing && card.stacking === 'refresh') {
    Object.assign(existing, effect, {
      id: existing.id,
      revealed: existing.revealed || effect.revealed,
    });
  } else {
    if (card.stacking === 'replace')
      state.effects = state.effects.filter(
        (e) => e.ownerId !== owner.id || e.cardId !== card.id,
      );
    state.effects.push(effect);
  }
}
function selectCard(
  state: MatchState,
  registry: EngineRegistry,
  cardId: string,
  targets: Record<string, TargetValue>,
) {
  requireRule(state.phase === 'battle', 'Match is in placement');
  requireRule(state.turn.selectedCardId === null, 'Card already selected');
  requireRule(state.turn.cardOffer.includes(cardId), 'Card was not offered');
  const card = getCard(state, registry, cardId);
  requireRule(
    selectable(state, state.turn.playerId, card),
    'Card is not selectable',
  );
  requireRule(
    validateTargets(state, state.turn.playerId, card, targets),
    'Illegal card target',
  );
  const owner = playerById(state, state.turn.playerId);
  state.turn.selectedCardId = cardId;
  const previousCount = Object.hasOwn(owner.cardsSelected, cardId)
    ? owner.cardsSelected[cardId]!
    : 0;
  Object.defineProperty(owner.cardsSelected, cardId, {
    value: previousCount + 1,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const immediate = card.effects.some((e) => e.trigger === 'on_selected');
  event(state, owner.id, 'card_selected', {
    cardId,
    targets: clone(targets),
    ...(card.visibility === 'public' || immediate
      ? { publicCardId: cardId }
      : {}),
  });
  for (const effect of card.effects.filter(
    (e) => e.trigger === 'on_selected',
  )) {
    if (state.result) break;
    resolveEffect(state, effect, {
      ownerId: owner.id,
      targets,
      damage: 0,
      registry,
    });
  }
  if (!state.result) activate(state, card, targets);
}
function randomReveal(
  state: MatchState,
  ownerId: string,
  enemyId: string,
  amount: number,
) {
  const owner = playerById(state, ownerId),
    enemy = playerById(state, enemyId);
  const hidden = quadrantCells(state.preset, enemy.quadrant).filter(
    (c) => !owner.revealed.includes(cellKey(c)),
  );
  for (let i = 0; i < amount && hidden.length; i++)
    reveal(
      state,
      ownerId,
      hidden.splice(randomIndex(state, hidden.length), 1)[0]!,
    );
}
type Modifier = Extract<EffectDefinition, { type: 'modifier' }>;
function modifiers(
  state: MatchState,
  registry: EngineRegistry,
  ownerId: string,
  kind: ModifierKind,
) {
  return state.effects
    .filter((a) => a.ownerId === ownerId && a.remainingCharges !== 0)
    .flatMap((active) =>
      getCard(state, registry, active.cardId)
        .effects.filter(
          (e): e is Modifier => e.type === 'modifier' && e.kind === kind,
        )
        .map((definition) => ({ active, definition })),
    );
}
function consumeModifier(
  state: MatchState,
  active: ActiveEffect,
  definition: Modifier,
  charged = true,
) {
  active.revealed = true;
  if (charged && active.remainingCharges !== null) active.remainingCharges--;
  event(state, active.ownerId, 'effect_triggered', {
    cardId: active.cardId,
    publicCardId: active.cardId,
    modifier: definition.kind,
  });
}
function dealDamage(
  state: MatchState,
  registry: EngineRegistry,
  attackerId: string,
  tower: Tower,
  base: number,
  attack: boolean,
) {
  let damage = base;
  const attackModifiers = attack
    ? [
        ...modifiers(state, registry, attackerId, 'attack_bonus'),
        ...modifiers(state, registry, attackerId, 'target_bonus').filter(
          (x) => x.active.targets[x.definition.target!] === tower.id,
        ),
        ...modifiers(state, registry, attackerId, 'focused_fire'),
      ]
    : [];
  // Replacement first, then additive bonuses, stable activation order within each group.
  for (const x of attackModifiers)
    if (x.definition.kind === 'attack_bonus')
      damage = Math.max(1 + x.definition.amount, damage);
  for (const x of attackModifiers)
    if (
      x.definition.kind === 'target_bonus' ||
      (x.definition.kind === 'focused_fire' &&
        x.active.hitTowerIds?.includes(tower.id))
    )
      damage += x.definition.amount;
  const bound = (kind: ModifierKind) =>
    modifiers(state, registry, tower.ownerId, kind).filter(
      (x) => x.active.targets[x.definition.target!] === tower.id,
    );
  const invulnerable = bound('invulnerable');
  if (invulnerable.length) {
    damage = 0;
    for (const x of invulnerable)
      consumeModifier(state, x.active, x.definition, false);
  } else {
    const context = { ownerId: tower.ownerId, targets: {}, tower, damage };
    trigger(state, registry, 'before_attack', context);
    damage = context.damage;
    for (const x of bound('shield')) {
      const prevented = Math.min(
        damage,
        x.active.shieldRemaining ?? x.definition.amount,
      );
      if (!prevented) continue;
      damage -= prevented;
      x.active.shieldRemaining =
        (x.active.shieldRemaining ?? x.definition.amount) - prevented;
      consumeModifier(state, x.active, x.definition, false);
      if (x.active.shieldRemaining === 0) x.active.remainingCharges = 0;
    }
  }
  if (attack) {
    for (const x of modifiers(
      state,
      registry,
      tower.ownerId,
      'counterintelligence',
    )) {
      randomReveal(state, tower.ownerId, attackerId, x.definition.amount);
      consumeModifier(state, x.active, x.definition);
    }
    if (damage > 0)
      for (const x of attackModifiers) {
        if (x.definition.kind === 'focused_fire') {
          x.active.hitTowerIds ??= [];
          if (!x.active.hitTowerIds.includes(tower.id))
            x.active.hitTowerIds.push(tower.id);
        }
        consumeModifier(state, x.active, x.definition);
      }
  }
  tower.health = Math.max(0, tower.health - damage);
  if (
    tower.health === 0 &&
    state.towers.filter((t) => t.ownerId === tower.ownerId).length === 1
  ) {
    const phoenix = modifiers(state, registry, tower.ownerId, 'phoenix')[0];
    if (phoenix) {
      tower.health = phoenix.definition.amount;
      consumeModifier(state, phoenix.active, phoenix.definition);
    }
  }
  const destroyed = tower.health === 0;
  if (destroyed) state.towers = state.towers.filter((t) => t.id !== tower.id);
  expireEffects(state, registry);
  if (damage > 0)
    trigger(state, registry, 'after_damage', {
      ownerId: tower.ownerId,
      targets: {},
      tower,
      damage,
    });
  if (destroyed)
    for (const x of modifiers(state, registry, attackerId, 'destroy_attack')) {
      state.turn.freeAttacksAvailable =
        (state.turn.freeAttacksAvailable ?? 0) + x.definition.amount;
      consumeModifier(state, x.active, x.definition);
    }
  event(state, attackerId, 'damage_resolved', {
    towerId: tower.id,
    damage,
    prevented: base > 0 && damage === 0,
    destroyed,
    health: tower.health,
  });
  return {
    outcome: destroyed ? 'destroyed' : damage === 0 ? 'prevented' : 'hit',
    health: tower.health,
    damage,
  };
}
function finish(state: MatchState, reason: 'last_survivor' | 'round_limit') {
  state.result = determineResult(state, reason);
  event(state, state.result.winnerId, 'match_ended', { reason });
}
function eliminate(state: MatchState, registry: EngineRegistry) {
  // During placement, players legitimately hold no towers yet; only battle
  // play treats a tower-less player as defeated.
  if (state.phase === 'battle')
    for (const player of state.players) {
      if (
        !player.eliminated &&
        !state.towers.some((t) => t.ownerId === player.id)
      ) {
        player.eliminated = true;
        event(state, player.id, 'eliminated');
      }
    }
  expireEffects(state, registry);
  if (state.players.filter((p) => !p.eliminated).length === 1)
    finish(state, 'last_survivor');
}
function placeTownHall(
  state: MatchState,
  registry: EngineRegistry,
  playerId: string,
  cell: Cell,
  now: number,
) {
  requireRule(state.phase === 'placement', 'Match is not in placement');
  const player = playerById(state, playerId);
  requireRule(
    ownsCell(state, player, cell) && !towerAt(state, cell),
    'Placement requires an empty own cell',
  );
  const tower: Tower = {
    id: `tower-${state.nextId++}`,
    ownerId: player.id,
    type: 'town_hall',
    health: 3,
    cells: [clone(cell)],
  };
  state.towers.push(tower);
  event(state, player.id, 'town_hall_placed', {
    cell: clone(cell),
    towerId: tower.id,
  });
  advancePlacement(state, registry, now);
}
function advancePlacement(
  state: MatchState,
  registry: EngineRegistry,
  now: number,
) {
  let index = state.turnOrder.indexOf(state.turn.playerId);
  for (let i = 0; i < state.turnOrder.length; i++) {
    index = (index + 1) % state.turnOrder.length;
    const candidate = playerById(state, state.turnOrder[index]!);
    if (
      !candidate.eliminated &&
      !state.towers.some((t) => t.ownerId === candidate.id)
    ) {
      state.turn.playerId = candidate.id;
      state.turn.deadline = now + TURN_DURATION_MS;
      return;
    }
  }
  state.phase = 'battle';
  state.turn.playerId =
    state.turnOrder.find((id) => !playerById(state, id).eliminated) ??
    state.turn.playerId;
  state.turn.number = 1;
  state.turn.round = 1;
  beginTurn(state, registry, now);
}
function performAction(
  state: MatchState,
  registry: EngineRegistry,
  action: Action,
  internalFree = false,
) {
  requireRule(state.phase === 'battle', 'Match is in placement');
  requireRule(state.turn.selectedCardId !== null, 'Choose a card first');
  requireRule(
    internalFree ||
      state.turn.actionsRemaining > 0 ||
      (action.type === 'attack' && (state.turn.freeAttacksAvailable ?? 0) > 0),
    'No actions remaining',
  );
  const pendingFree =
    !internalFree &&
    action.type === 'attack' &&
    (state.turn.freeAttacksAvailable ?? 0) > 0;
  let free = internalFree || pendingFree;
  let actionTower: Tower | undefined;
  const player = playerById(state, state.turn.playerId);
  let details: Record<string, unknown> = {};
  if ('cell' in action)
    requireRule(inBounds(state.preset, action.cell), 'Cell is outside board');
  if (action.type === 'build') {
    requireRule(
      ownsCell(state, player, action.cell) && !towerAt(state, action.cell),
      'Build requires an empty own cell',
    );
    const tower: Tower = {
      id: `tower-${state.nextId++}`,
      ownerId: player.id,
      type: 'normal',
      health: 1,
      cells: [clone(action.cell)],
    };
    state.towers.push(tower);
    actionTower = tower;
    details = { cell: clone(action.cell), towerId: tower.id };
    trigger(state, registry, 'on_build', {
      ownerId: player.id,
      targets: {},
      tower,
      damage: 0,
    });
  } else if (action.type === 'upgrade' || action.type === 'expand') {
    const tower = state.towers.find((t) => t.id === action.towerId);
    requireRule(tower && tower.ownerId === player.id, 'Select an owned tower');
    actionTower = tower;
    if (action.type === 'upgrade') {
      requireRule(tower.health < 10, 'Health is already capped');
      tower.health++;
      details = { towerId: tower.id, health: tower.health };
    } else {
      requireRule(
        ownsCell(state, player, action.cell) &&
          !towerAt(state, action.cell) &&
          tower.cells.some((cell) => adjacent(cell, action.cell)),
        'Expansion requires an empty orthogonally adjacent own cell',
      );
      tower.cells.push(clone(action.cell));
      details = { towerId: tower.id, cell: clone(action.cell) };
    }
  } else {
    requireRule(
      !ownsCell(state, player, action.cell) && occupiedCell(state, action.cell),
      'Attack requires an occupied enemy quadrant',
    );
    reveal(state, player.id, action.cell);
    const tower = towerAt(state, action.cell);
    details = { cell: clone(action.cell), outcome: 'miss' };
    if (tower) {
      const result = dealDamage(state, registry, player.id, tower, 1, true);
      details = { cell: clone(action.cell), towerId: tower.id, ...result };
    }
    for (const { active, definition } of modifiers(
      state,
      registry,
      player.id,
      'spotter',
    )) {
      for (const c of neighbors(state, action.cell))
        reveal(state, player.id, c);
      consumeModifier(state, active, definition);
    }
  }
  event(state, player.id, action.type, details);
  if (!internalFree) {
    if (action.type === 'build' || action.type === 'expand') {
      const matches = [
        ...modifiers(state, registry, player.id, 'free_build_expand'),
        ...modifiers(state, registry, player.id, 'free_expand').filter(
          (x) =>
            action.type === 'expand' &&
            x.active.targets[x.definition.target!] === actionTower?.id,
        ),
      ];
      if (matches[0]) {
        free = true;
        consumeModifier(state, matches[0].active, matches[0].definition);
      }
    }
    for (const { active, definition } of pendingFree
      ? []
      : modifiers(state, registry, player.id, 'momentum')) {
      if (
        (state.turn.normalActionsTaken ?? 0) === 0 &&
        actionTower &&
        (action.type === 'build' || action.type === 'expand')
      )
        actionTower.health = Math.min(
          10,
          actionTower.health + definition.amount,
        );
      consumeModifier(state, active, definition);
    }
    if (action.type === 'build' && actionTower)
      for (const { active, definition } of modifiers(
        state,
        registry,
        player.id,
        'build_health',
      )) {
        actionTower.health = Math.min(
          10,
          actionTower.health + definition.amount,
        );
        consumeModifier(state, active, definition);
      }
    if (pendingFree) state.turn.freeAttacksAvailable!--;
    if (!free) state.turn.actionsRemaining--;
    if (!pendingFree)
      state.turn.normalActionsTaken = (state.turn.normalActionsTaken ?? 0) + 1;
  }
  eliminate(state, registry);
}
function repairOfferAfterForfeit(state: MatchState, registry: EngineRegistry) {
  if (
    state.result ||
    state.phase !== 'battle' ||
    state.turn.selectedCardId !== null
  )
    return;
  const { catalog } = pinnedContent(state, registry);
  const offered = state.turn.cardOffer;
  const retained = offered.filter((id) =>
    selectable(state, state.turn.playerId, getCard(state, registry, id)),
  );
  if (retained.length === offered.length) return;
  const replacements = catalog.fallbackCardIds.filter(
    (id) => !retained.includes(id),
  );
  state.turn.cardOffer = offered.map((id) =>
    retained.includes(id) ? id : replacements.shift()!,
  );
  event(state, state.turn.playerId, 'card_offer', {
    cardIds: [...state.turn.cardOffer],
    reason: 'forfeit_invalidated_targets',
  });
}
function beginTurn(state: MatchState, registry: EngineRegistry, now: number) {
  playerById(state, state.turn.playerId).turnsStarted++;
  state.turn.actionsRemaining = 2;
  state.turn.freeAttacksAvailable = 0;
  state.turn.normalActionsTaken = 0;
  state.turn.selectedCardId = null;
  state.turn.deadline = now + TURN_DURATION_MS;
  expireEffects(state, registry);
  trigger(state, registry, 'on_turn_start', {
    ownerId: state.turn.playerId,
    targets: {},
    damage: 0,
  });
  const offer = generateOffer(state, registry);
  state.rngState = offer.rngState;
  state.turn.cardOffer = offer.cardIds;
  event(state, state.turn.playerId, 'turn_started', {
    round: state.turn.round,
  });
  event(state, state.turn.playerId, 'card_offer', {
    cardIds: [...offer.cardIds],
  });
}
function endTurn(state: MatchState, registry: EngineRegistry, now: number) {
  requireRule(state.phase === 'battle', 'Match is in placement');
  requireRule(
    state.turn.actionsRemaining === 0 &&
      (state.turn.freeAttacksAvailable ?? 0) === 0,
    'Resolve all actions and free attacks first',
  );
  expireEffects(state, registry, true);
  event(state, state.turn.playerId, 'turn_ended');
  advanceTurn(state, registry, now);
}
function advanceTurn(state: MatchState, registry: EngineRegistry, now: number) {
  let index = state.turnOrder.indexOf(state.turn.playerId);
  do {
    index = (index + 1) % state.turnOrder.length;
    if (index === 0) {
      if (state.turn.round === PRESETS[state.preset].rounds) {
        finish(state, 'round_limit');
        return;
      }
      state.turn.round++;
    }
  } while (playerById(state, state.turnOrder[index]!).eliminated);
  state.turn.playerId = state.turnOrder[index]!;
  state.turn.number++;
  beginTurn(state, registry, now);
}
export function createMatch(
  input: {
    id: string;
    playerIds: string[];
    preset: PresetId;
    seed: number;
    now: number;
    cardCatalogVersion: string;
    balanceVersion: string;
  },
  registry: EngineRegistry,
): MatchState {
  requireRule(
    input.playerIds.length >= 2 &&
      input.playerIds.length <= 4 &&
      new Set(input.playerIds).size === input.playerIds.length &&
      input.playerIds.every((id) => typeof id === 'string' && id.length > 0),
    'Two to four distinct players required',
  );
  requireRule(Object.hasOwn(PRESETS, input.preset), 'Unknown board preset');
  requireRule(
    Number.isInteger(input.seed) && input.seed >= 0 && input.seed <= 0xffffffff,
    'Seed must be uint32',
  );
  requireRule(
    Number.isSafeInteger(input.now) &&
      input.now >= 0 &&
      Number.isSafeInteger(input.now + TURN_DURATION_MS),
    'Invalid time',
  );
  pinnedContent(input, registry);
  const cursor = { rngState: input.seed };
  const quadrants = shuffle(cursor, QUADRANTS);
  const turnOrder = shuffle(cursor, input.playerIds);
  const state: MatchState = {
    id: input.id,
    preset: input.preset,
    cardCatalogVersion: input.cardCatalogVersion,
    balanceVersion: input.balanceVersion,
    seed: input.seed,
    rngState: cursor.rngState,
    nextId: 1,
    version: 0,
    lastCommandAt: input.now,
    phase: 'placement',
    players: input.playerIds.map((id, i) => ({
      id,
      quadrant: quadrants[i]!,
      eliminated: false,
      timedOutTurns: 0,
      turnsStarted: 0,
      revealed: [],
      cardsSelected: {},
    })),
    turnOrder,
    towers: [],
    effects: [],
    history: [],
    result: null,
    turn: {
      playerId: turnOrder[0]!,
      number: 1,
      round: 1,
      actionsRemaining: 0,
      cardOffer: [],
      selectedCardId: null,
      deadline: input.now + TURN_DURATION_MS,
    },
  };
  event(state, state.turn.playerId, 'setup', {
    quadrants,
    turnOrder: [...turnOrder],
  });
  return state;
}
// Invalid transitions return the original object, including RNG, history and action budget.
// Networking authenticates actorId and serializes commands; timeouts and forfeits are server-only.
export function applyCommand(
  state: MatchState,
  actorId: string | null,
  command: Command,
  now: number,
  registry: EngineRegistry,
): Transition {
  try {
    requireRule(!state.result, 'Match is finished');
    requireRule(
      Number.isSafeInteger(now) &&
        now >= state.lastCommandAt &&
        Number.isSafeInteger(now + TURN_DURATION_MS),
      'Invalid time',
    );
    requireRule(command && typeof command === 'object', 'Invalid command');
    pinnedContent(state, registry);
    const next = clone(state);
    if (command.type === 'forfeit') {
      requireRule(actorId === null, 'Forfeit is server-only');
      const player = playerById(next, command.playerId);
      requireRule(!player.eliminated, 'Player is already eliminated');
      next.towers = next.towers.filter(
        (tower) => tower.ownerId !== command.playerId,
      );
      if (next.phase === 'placement') {
        player.eliminated = true;
        event(next, player.id, 'eliminated');
      }
      eliminate(next, registry);
      if (!next.result && next.turn.playerId === player.id) {
        if (next.phase === 'placement') {
          advancePlacement(next, registry, now);
        } else {
          expireEffects(next, registry, true);
          event(next, player.id, 'turn_ended');
          advanceTurn(next, registry, now);
        }
      }
      repairOfferAfterForfeit(next, registry);
    } else if (command.type === 'timeout') {
      requireRule(actorId === null, 'Timeout is server-only');
      requireRule(now >= state.turn.deadline, 'Turn has not timed out');
      const player = playerById(next, next.turn.playerId);
      player.timedOutTurns++;
      event(next, player.id, 'timeout');
      if (next.phase === 'placement') {
        const cells = quadrantCells(next.preset, player.quadrant).filter(
          (cell) => !towerAt(next, cell),
        );
        placeTownHall(
          next,
          registry,
          player.id,
          cells[randomIndex(next, cells.length)]!,
          now,
        );
      } else {
        if (next.turn.selectedCardId === null) {
          const card = getCard(
            next,
            registry,
            next.turn.cardOffer[randomIndex(next, 3)]!,
          );
          const targets = fallbackTargets(next, player.id, card);
          selectCard(next, registry, card.id, targets);
        }
        const enemyCells = allCells(next.preset).filter(
          (cell) => !ownsCell(next, player, cell) && occupiedCell(next, cell),
        );
        while (
          (next.turn.actionsRemaining > 0 ||
            (next.turn.freeAttacksAvailable ?? 0) > 0) &&
          !next.result
        )
          performAction(next, registry, {
            type: 'attack',
            cell: enemyCells[randomIndex(next, enemyCells.length)]!,
          });
        if (!next.result) endTurn(next, registry, now);
      }
    } else {
      requireRule(
        actorId === state.turn.playerId &&
          !playerById(state, actorId).eliminated,
        'Not your turn',
      );
      requireRule(now < state.turn.deadline, 'Turn deadline elapsed');
      switch (command.type) {
        case 'select_card':
          selectCard(next, registry, command.cardId, command.targets);
          break;
        case 'build':
        case 'upgrade':
        case 'expand':
        case 'attack':
          performAction(next, registry, command);
          break;
        case 'place_town_hall':
          placeTownHall(next, registry, actorId, command.cell, now);
          break;
        case 'end_turn':
          endTurn(next, registry, now);
          break;
        default:
          throw new Error('Unknown command');
      }
    }
    next.version++;
    next.lastCommandAt = now;
    return { ok: true, state: next };
  } catch (error) {
    return {
      ok: false,
      state,
      error: error instanceof Error ? error.message : 'Invalid command',
    };
  }
}
