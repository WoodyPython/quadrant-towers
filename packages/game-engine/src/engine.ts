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
  sameCell,
  towerAt,
} from './board.js';
import {
  generateOffer,
  legalTargets,
  pinnedContent,
  selectable,
} from './cards/registry.js';
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
        target.kind.endsWith('own_tower') &&
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
    const tower =
      effect.target === 'event_tower'
        ? context.tower
        : state.towers.find((t) => t.id === context.targets[effect.target]);
    if (tower && tower.ownerId === context.ownerId && tower.health > 0)
      tower.health = Math.min(10, tower.health + effect.amount);
  },
  reveal: (state, effect, context) => {
    const cell = context.targets[effect.target];
    if (cell && typeof cell !== 'string') reveal(state, context.ownerId, cell);
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
  switch (effect.type) {
    case 'neutral':
      return effectHandlers.neutral(state, effect, context);
    case 'heal':
      return effectHandlers.heal(state, effect, context);
    case 'reveal':
      return effectHandlers.reveal(state, effect, context);
    case 'prevent_damage':
      return effectHandlers.prevent_damage(state, effect, context);
  }
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
      duration.type === 'owner_turns'
        ? owner.turnsStarted + duration.count
        : null,
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
    Object.keys(targets).length === card.targets.length,
    'Incorrect card targets',
  );
  for (const target of card.targets) {
    const selected = targets[target.id];
    requireRule(
      legalTargets(state, state.turn.playerId, target).some((legal) =>
        typeof legal === 'string'
          ? legal === selected
          : typeof selected === 'object' &&
            selected !== null &&
            sameCell(legal, selected),
      ),
      'Illegal card target',
    );
  }
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
  for (const effect of card.effects.filter((e) => e.trigger === 'on_selected'))
    resolveEffect(state, effect, { ownerId: owner.id, targets, damage: 0 });
  activate(state, card, targets);
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
) {
  requireRule(state.phase === 'battle', 'Match is in placement');
  requireRule(state.turn.selectedCardId !== null, 'Choose a card first');
  requireRule(state.turn.actionsRemaining > 0, 'No actions remaining');
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
      const context = { ownerId: tower.ownerId, targets: {}, tower, damage: 1 };
      trigger(state, registry, 'before_attack', context);
      tower.health = Math.max(0, tower.health - context.damage);
      const destroyed = tower.health === 0;
      if (destroyed)
        state.towers = state.towers.filter((t) => t.id !== tower.id);
      // Lethal damage cannot be healed; destroyed targets expire before after_damage.
      expireEffects(state, registry);
      if (context.damage > 0) trigger(state, registry, 'after_damage', context);
      details = {
        cell: clone(action.cell),
        outcome: destroyed
          ? 'destroyed'
          : context.damage === 0
            ? 'prevented'
            : 'hit',
        health: tower.health,
        towerId: tower.id,
      };
    }
  }
  event(state, player.id, action.type, details);
  state.turn.actionsRemaining--;
  eliminate(state, registry);
}
function beginTurn(state: MatchState, registry: EngineRegistry, now: number) {
  playerById(state, state.turn.playerId).turnsStarted++;
  state.turn.actionsRemaining = 2;
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
    state.turn.actionsRemaining === 0,
    'Resolve exactly two actions first',
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
          const targets = Object.fromEntries(
            card.targets.map((target) => [
              target.id,
              legalTargets(next, player.id, target)[0]!,
            ]),
          );
          selectCard(next, registry, card.id, targets);
        }
        const enemyCells = allCells(next.preset).filter(
          (cell) => !ownsCell(next, player, cell) && occupiedCell(next, cell),
        );
        while (next.turn.actionsRemaining > 0 && !next.result)
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
