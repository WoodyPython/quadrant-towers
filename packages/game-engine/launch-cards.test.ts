import { randomIndex } from './src/random.js';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createMatch,
  defaultRegistry,
  launchCards,
  launchCatalog,
  launchBalance,
  rarityAnchors,
  fallbackTargets,
  validateTargets,
  generateOffer,
  selectable,
  rarityWeight,
  quadrantCells,
  towerAt,
  cellKey,
  projectMatch,
  adjacent,
  PRESETS,
  createRegistry,
  type PresetId,
  type MatchState,
  type Command,
  type TargetValue,
  type Cell,
} from './src/index.js';
const copy = <T>(v: T): T => structuredClone(v);
function run(state: MatchState, command: Command): MatchState {
  const result = applyCommand(
    state,
    command.type === 'timeout' || command.type === 'forfeit'
      ? null
      : state.turn.playerId,
    command,
    command.type === 'timeout' ? state.turn.deadline : state.lastCommandAt,
    defaultRegistry,
  );
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
function setup(preset: PresetId = 'small') {
  let state = createMatch(
    {
      id: 'match',
      playerIds: ['a', 'b', 'c', 'd'],
      preset,
      seed: 12,
      now: 0,
      cardCatalogVersion: 'launch-2',
      balanceVersion: 'launch-2',
    },
    defaultRegistry,
  );
  while (state.phase === 'placement') {
    const player = state.players.find((p) => p.id === state.turn.playerId)!;
    state = run(state, {
      type: 'place_town_hall',
      cell: quadrantCells(state.preset, player.quadrant)[0]!,
    });
  }
  const player = state.players.find((p) => p.id === state.turn.playerId)!;
  const ownCells = quadrantCells(state.preset, player.quadrant);
  state.towers.push({
    id: 'spare',
    ownerId: player.id,
    type: 'normal',
    health: 1,
    cells: [ownCells[5]!],
  });
  player.revealed = state.towers
    .filter((t) => t.ownerId !== player.id)
    .map((t) => cellKey(t.cells[0]!));
  return state;
}
const card = (id: string) => launchCards.find((c) => c.id === id)!;
const own = (s: MatchState) =>
  s.towers.find((t) => t.ownerId === s.turn.playerId)!;
const enemy = (s: MatchState) =>
  s.towers.find((t) => t.ownerId !== s.turn.playerId)!;
function choose(
  state: MatchState,
  id: string,
  targets?: Record<string, TargetValue>,
) {
  state = copy(state);
  state.turn.selectedCardId = null;
  state.turn.cardOffer = [id, 'neutral_reserve', 'neutral_patience'];
  return run(state, {
    type: 'select_card',
    cardId: id,
    targets: targets ?? fallbackTargets(state, state.turn.playerId, card(id)),
  });
}
function end(state: MatchState) {
  while (
    state.turn.actionsRemaining > 0 ||
    (state.turn.freeAttacksAvailable ?? 0) > 0
  ) {
    const target = state.players.find((p) => p.id !== state.turn.playerId)!;
    const cell = quadrantCells(state.preset, target.quadrant).find(
      (c) => !towerAt(state, c),
    )!;
    state = run(state, { type: 'attack', cell });
  }
  return run(state, { type: 'end_turn' });
}
function hitOwner(state: MatchState, towerId: string) {
  const tower = state.towers.find((t) => t.id === towerId)!;
  state = choose(state, 'spotter');
  return run(state, { type: 'attack', cell: tower.cells[0]! });
}

describe('launch catalog and offers', () => {
  it('has 45 unique versioned cards with 10/10/10/10/5 counts and legal deterministic fallbacks', () => {
    expect(launchCards).toHaveLength(45);
    expect(new Set(launchCards.map((c) => c.id)).size).toBe(45);
    expect(
      launchBalance.rarities.map(
        (r) => launchCards.filter((c) => c.rarityId === r.id).length,
      ),
    ).toEqual([10, 10, 10, 10, 5]);
    const state = setup();
    for (const c of launchCards) {
      expect(c.version).toBe(1);
      expect(c.description.length).toBeGreaterThan(10);
      expect(c.artKey).toBe(c.id);
      expect(c.effects.length).toBeGreaterThan(0);
      expect(c.targets.every((t) => t.fallback === 'first_legal')).toBe(true);
      const targets = fallbackTargets(state, state.turn.playerId, c);
      expect(
        validateTargets(state, state.turn.playerId, c, targets),
        c.id,
      ).toBe(true);
      expect(targets).toEqual(
        fallbackTargets(copy(state), state.turn.playerId, c),
      );
    }
  });
  it.each(rarityAnchors)('matches anchor $progress', (a) => {
    const weights = launchBalance.rarities.map((r) =>
      rarityWeight(r, a.progress),
    );
    weights.forEach((w, i) => expect(w).toBeCloseTo(a.weights[i]!));
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });
  it.each([0.1, 0.3, 0.5, 0.7, 0.9])('interpolates at %s', (progress) => {
    const end = rarityAnchors.findIndex((a) => a.progress >= progress),
      lo = rarityAnchors[end - 1]!,
      hi = rarityAnchors[end]!;
    launchBalance.rarities.forEach((r, i) =>
      expect(rarityWeight(r, progress)).toBeCloseTo(
        lo.weights[i]! +
          ((hi.weights[i]! - lo.weights[i]!) * (progress - lo.progress)) /
            (hi.progress - lo.progress),
      ),
    );
  });
  it('keeps Legendary at zero through .4 and gives 15% per slot at match end', () => {
    const legendary = launchBalance.rarities[4]!;
    for (const p of [0, 0.1, 0.2, 0.3, 0.4])
      expect(rarityWeight(legendary, p)).toBe(0);
    expect(rarityWeight(legendary, 0.5)).toBeCloseTo(1);
    expect(rarityWeight(legendary, 1)).toBe(15);
  });
  it.each(['small', 'medium', 'large', 'massive'] as const)(
    'offers exactly three distinct legal cards across %s rounds and seeds',
    (preset) => {
      const state = setup(preset);
      for (const round of [
        1,
        Math.ceil(PRESETS[preset].rounds / 2),
        PRESETS[preset].rounds,
      ])
        for (let seed = 0; seed < 25; seed++) {
          state.turn.round = round;
          state.rngState = seed;
          const offer = generateOffer(state, defaultRegistry);
          expect(offer).toEqual(generateOffer(copy(state), defaultRegistry));
          expect(new Set(offer.cardIds).size).toBe(3);
          for (const id of offer.cardIds)
            expect(
              selectable(
                state,
                state.turn.playerId,
                launchCatalog.cards.find((c) => c.id === id)!,
              ),
            ).toBe(true);
          expect(offer.cardIds.some((id) => id.startsWith('neutral_'))).toBe(
            false,
          );
        }
    },
  );
  it('offers three distinct legal cards on full fully revealed boards', () => {
    const state = setup(),
      player = state.players.find((p) => p.id === state.turn.playerId)!;
    state.towers = state.players.flatMap((p) =>
      quadrantCells(state.preset, p.quadrant).map((c, i) => ({
        id: `${p.id}-${i}`,
        ownerId: p.id,
        type: 'normal' as const,
        cells: [c],
        health: 10,
      })),
    );
    player.revealed = state.towers
      .filter((t) => t.ownerId !== player.id)
      .flatMap((t) => t.cells.map(cellKey));
    const offer = generateOffer(state, defaultRegistry);
    expect(new Set(offer.cardIds).size).toBe(3);
    expect(
      offer.cardIds.every((id) =>
        selectable(
          state,
          player.id,
          launchCatalog.cards.find((c) => c.id === id)!,
        ),
      ),
    ).toBe(true);
  });
  it('uses internal neutral definitions only when weighted tiers have no choices', () => {
    const state = setup();
    const registry = {
      ...defaultRegistry,
      catalogs: {
        ...defaultRegistry.catalogs,
        'launch-2': {
          ...launchCatalog,
          cards: launchCatalog.cards.filter((c) => c.fallbackOnly),
        },
      },
    };
    expect(new Set(generateOffer(state, registry).cardIds)).toEqual(
      new Set(launchCatalog.fallbackCardIds),
    );
  });
  it('filters capped healing, unseen towers, full quadrants, and insufficient infrastructure cells', () => {
    const state = setup(),
      owner = state.players.find((p) => p.id === state.turn.playerId)!;
    state.towers
      .filter((t) => t.ownerId === owner.id)
      .forEach((t) => (t.health = 10));
    for (const id of [
      'field_repairs',
      'repair_crew',
      'fortress',
      'emergency_patch',
      'reinforcement_protocol',
    ])
      expect(selectable(state, owner.id, card(id))).toBe(false);
    owner.revealed = [];
    for (const id of ['weak_point', 'precision_strike', 'heavy_artillery'])
      expect(selectable(state, owner.id, card(id))).toBe(false);
    owner.revealed = state.players
      .filter((p) => p.id !== owner.id)
      .flatMap((p) => quadrantCells(state.preset, p.quadrant).map(cellKey));
    expect(selectable(state, owner.id, card('all_seeing_eye'))).toBe(false);
    const tower = own(state);
    tower.cells = quadrantCells(state.preset, owner.quadrant).filter(
      (c) =>
        !state.towers.some(
          (t) =>
            t.id !== tower.id && t.cells.some((x) => cellKey(x) === cellKey(c)),
        ),
    );
    expect(selectable(state, owner.id, card('emergency_infrastructure'))).toBe(
      false,
    );
  });
});

describe('all launch cards resolve atomically', () => {
  it.each(launchCards.map((c) => [c.id]))('%s success and timeout', (id) => {
    const state = setup();
    const targets = fallbackTargets(state, state.turn.playerId, card(id!));
    const next = choose(state, id!, targets);
    expect(next.turn.selectedCardId).toBe(id);
    const bonus = card(id!)
      .effects.filter((e) => e.type === 'extra_actions')
      .reduce((sum, e) => sum + ('amount' in e ? e.amount : 0), 0);
    expect(next.turn.actionsRemaining).toBe(2 + bonus);
    for (const effect of card(id!).effects) {
      if (effect.type === 'heal')
        for (const t of next.towers.filter(
          (t) => t.ownerId === next.turn.playerId,
        ))
          if (
            t.id === targets[effect.target] ||
            (Array.isArray(targets[effect.target]) &&
              (targets[effect.target] as string[]).includes(t.id))
          )
            expect(t.health).toBe(
              Math.min(
                10,
                state.towers.find((x) => x.id === t.id)!.health + effect.amount,
              ),
            );
      if (effect.type === 'build_free') {
        const created = next.towers.filter(
          (t) => !state.towers.some((old) => old.id === t.id),
        );
        expect(created).toHaveLength(card(id!).targets[0]!.count!);
        expect(created.every((t) => t.health === effect.health)).toBe(true);
      }
      if (effect.type === 'expand_free')
        expect(
          next.towers.find((t) => t.id === targets[effect.target])!.cells
            .length - own(state).cells.length,
        ).toBe((targets[effect.cellsTarget] as Cell[]).length);
      if (effect.type === 'modifier')
        expect(next.effects.some((a) => a.cardId === id)).toBe(true);
    }
    const timeout = copy(state);
    timeout.turn.cardOffer = [id!, 'neutral_reserve', 'neutral_patience'];
    let seed = 0;
    while (randomIndex({ rngState: seed }, 3) !== 0) seed++;
    timeout.rngState = seed;
    const timed = run(timeout, { type: 'timeout' });
    expect(timed.turn.number > state.turn.number || timed.result !== null).toBe(
      true,
    );
    expect(
      timed.history.find((e) => e.type === 'card_selected')!.details.cardId,
    ).toBe(id);
    expect(state.turn.selectedCardId).toBeNull();
  });
});

describe('target validation, free building and private reveals', () => {
  it.each([
    'scout_drone',
    'recon_sweep',
    'satellite_scan',
    'deep_surveillance',
  ])('%s reveals the entire rectangle and rejects crossing quadrants', (id) => {
    let state = setup();
    const c = card(id),
      enemyPlayer = state.players.find((p) => p.id !== state.turn.playerId)!;
    state.players.find((p) => p.id === state.turn.playerId)!.revealed = [];
    const cells = quadrantCells(state.preset, enemyPlayer.quadrant),
      size = c.targets[0]!.size!;
    const invalid = applyCommand(
      {
        ...state,
        turn: {
          ...state.turn,
          cardOffer: [id, 'neutral_reserve', 'neutral_patience'],
        },
      },
      state.turn.playerId,
      { type: 'select_card', cardId: id, targets: { cell: cells.at(-1)! } },
      state.lastCommandAt,
      defaultRegistry,
    );
    expect(invalid.ok).toBe(false);
    state = choose(state, id, { cell: cells[0]! });
    expect(
      state.players.find((p) => p.id === state.turn.playerId)!.revealed,
    ).toHaveLength(size * size);
    expect(
      state.players
        .filter((p) => p.id !== state.turn.playerId)
        .every((p) => p.revealed.length === 0),
    ).toBe(true);
  });
  it('rejects disconnected Surveyor sets and duplicate build cells without mutating anything', () => {
    const state = setup(),
      cells = quadrantCells(
        state.preset,
        state.players.find((p) => p.id !== state.turn.playerId)!.quadrant,
      );
    for (const [id, targets] of [
      ['surveyor', { cells: [cells[0], cells[1], cells[35]] }],
      ['emergency_infrastructure', { cells: [cells[0], cells[0]] }],
    ] as [string, Record<string, TargetValue>][]) {
      const input = copy(state);
      input.turn.cardOffer = [id, 'neutral_reserve', 'neutral_patience'];
      const result = applyCommand(
        input,
        input.turn.playerId,
        { type: 'select_card', cardId: id, targets },
        input.lastCommandAt,
        defaultRegistry,
      );
      expect(result.ok).toBe(false);
      expect(result.state).toBe(input);
      expect(result.state).toEqual(input);
    }
  });
  it.each(['double_expansion', 'master_architect', 'ascension'])(
    '%s validates sequential adjacency and accepts one cell',
    (id) => {
      const state = setup(),
        tower = own(state),
        origin = tower.cells[0]!;
      const cells = [
        { x: origin.x, y: origin.y + 1 },
        { x: origin.x, y: origin.y + 2 },
      ];
      expect(adjacent(origin, cells[1]!)).toBe(false);
      const next = choose(state, id, { tower: tower.id, cells });
      expect(next.towers.find((t) => t.id === tower.id)!.cells).toHaveLength(3);
      expect(
        choose(state, id, { tower: tower.id, cells: [cells[0]!] }).turn
          .actionsRemaining,
      ).toBe(2);
      expect(
        validateTargets(state, state.turn.playerId, card(id), {
          tower: tower.id,
          cells: [cells[1]!],
        }),
      ).toBe(false);
    },
  );
  it('creates separate infrastructure towers even when cells touch', () => {
    const state = setup(),
      origin = own(state).cells[0]!,
      cells = [
        { x: origin.x, y: origin.y + 1 },
        { x: origin.x + 1, y: origin.y + 1 },
      ];
    const next = choose(state, 'emergency_infrastructure', { cells });
    expect(towerAt(next, cells[0]!)!.id).not.toBe(towerAt(next, cells[1]!)!.id);
    expect(towerAt(next, cells[0]!)!.health).toBe(2);
    expect(next.turn.actionsRemaining).toBe(2);
  });
  it('Rangefinder and Spotter reveal orthogonal neighbors only and Spotter triggers on a miss', () => {
    const state = setup(),
      target = enemy(state).cells[0]!;
    const next = choose(state, 'rangefinder', { cell: target }),
      player = next.players.find((p) => p.id === next.turn.playerId)!;
    expect(player.revealed).toContain(
      cellKey({ x: target.x + 1, y: target.y }),
    );
    expect(player.revealed).not.toContain(
      cellKey({ x: target.x + 1, y: target.y + 1 }),
    );
    const miss = { x: target.x + 2, y: target.y + 2 };
    const spotted = run(choose(state, 'spotter'), {
      type: 'attack',
      cell: miss,
    });
    const visible = spotted.players.find(
      (p) => p.id === spotted.turn.playerId,
    )!.revealed;
    expect(visible).toContain(cellKey({ x: miss.x - 1, y: miss.y }));
    expect(spotted.effects.some((e) => e.cardId === 'spotter')).toBe(false);
    const ranged = choose(state, 'rangefinder', { cell: miss });
    expect(
      ranged.players.find((p) => p.id === ranged.turn.playerId)!.revealed,
    ).not.toContain(cellKey({ x: miss.x - 1, y: miss.y }));
  });
  it('Strategic Recon reveals exactly one row and column and All-Seeing Eye stays private', () => {
    const state = setup(),
      target = enemy(state),
      owner = state.players.find((p) => p.id === state.turn.playerId)!;
    owner.revealed = [];
    const recon = choose(state, 'strategic_recon', { cell: target.cells[0]! });
    expect(recon.players.find((p) => p.id === owner.id)!.revealed).toHaveLength(
      11,
    );
    const eye = choose(state, 'all_seeing_eye', { player: target.ownerId });
    expect(eye.players.find((p) => p.id === owner.id)!.revealed).toHaveLength(
      36,
    );
    expect(
      projectMatch(eye, target.ownerId).cells.filter(
        (c) => c.visibility === 'visible' && c.tower?.ownerId === owner.id,
      ),
    ).toHaveLength(0);
  });
  it('random reveals are deterministic, hidden-only, unique and skip eliminated enemies', () => {
    const state = setup();
    const eliminated = state.players.find((p) => p.id !== state.turn.playerId)!;
    eliminated.eliminated = true;
    state.towers = state.towers.filter((t) => t.ownerId !== eliminated.id);
    const next = choose(state, 'intelligence_network');
    expect(next).toEqual(choose(copy(state), 'intelligence_network'));
    const before = state.players.find(
      (p) => p.id === state.turn.playerId,
    )!.revealed;
    const after = next.players.find(
      (p) => p.id === next.turn.playerId,
    )!.revealed;
    expect(after.length - before.length).toBe(4);
    expect(new Set(after).size).toBe(after.length);
  });
  it.each(['precision_strike', 'heavy_artillery'])(
    '%s targets known towers without exposing their footprint',
    (id) => {
      const state = setup(),
        target = enemy(state),
        origin = target.cells[0]!;
      target.health = 10;
      target.cells.push({ x: origin.x + 1, y: origin.y });
      const next = choose(state, id, { tower: target.id });
      const hidden = projectMatch(next, next.turn.playerId).cells.find(
        (c) => cellKey(c.cell) === cellKey(target.cells[1]!),
      )!;
      expect(hidden.visibility).toBe('hidden');
      expect(next.turn.actionsRemaining).toBe(2);
      state.players.find((p) => p.id === state.turn.playerId)!.revealed = [];
      expect(
        validateTargets(state, state.turn.playerId, card(id), {
          tower: target.id,
        }),
      ).toBe(false);
      const observer = projectMatch(
        next,
        state.players.find(
          (p) => p.id !== next.turn.playerId && p.id !== target.ownerId,
        )!.id,
      );
      expect(
        observer.history.find((e) => e.type === 'card_selected')!.details,
      ).toEqual({ cardId: id });
      expect(
        observer.history
          .filter((e) => e.type === 'damage_resolved')
          .every((e) => !e.details),
      ).toBe(true);
    },
  );
  it.each([
    ['air_strike', 1, 3],
    ['cataclysm', 2, 4],
  ] as const)(
    '%s damages each intersecting tower once and reveals only the blast',
    (id, damage, size) => {
      const state = setup(),
        target = enemy(state),
        origin = target.cells[0]!;
      target.health = 10;
      target.cells = [
        origin,
        { x: origin.x + 1, y: origin.y },
        { x: origin.x + 2, y: origin.y },
        { x: origin.x + 3, y: origin.y },
        { x: origin.x + 4, y: origin.y },
      ];
      state.players.find((p) => p.id === state.turn.playerId)!.revealed = [];
      const next = choose(state, id, { cell: origin });
      expect(next.towers.find((t) => t.id === target.id)!.health).toBe(
        10 - damage,
      );
      expect(
        next.players.find((p) => p.id === next.turn.playerId)!.revealed,
      ).toHaveLength(size * size);
      expect(
        projectMatch(next, next.turn.playerId).cells.find(
          (c) => cellKey(c.cell) === cellKey(target.cells[4]!),
        )!.visibility,
      ).toBe('hidden');
      expect(
        next.history.filter((e) => e.type === 'damage_resolved'),
      ).toHaveLength(1);
    },
  );
});

describe('passive interactions and action economy', () => {
  it('Expansion Plans and Mobilization use zero-cost operations and expire unused', () => {
    const state = setup(),
      tower = own(state),
      origin = tower.cells[0]!,
      cell = { x: origin.x, y: origin.y + 1 };
    let planned = choose(state, 'expansion_plans', { tower: tower.id });
    planned = run(planned, { type: 'expand', towerId: tower.id, cell });
    expect(planned.turn.actionsRemaining).toBe(2);
    expect(planned.effects.some((e) => e.cardId === 'expansion_plans')).toBe(
      false,
    );
    let mobilized = choose(state, 'mobilization');
    mobilized = run(mobilized, { type: 'build', cell });
    expect(mobilized.turn.actionsRemaining).toBe(3);
    for (let i = 0; i < 3; i++)
      mobilized = run(mobilized, { type: 'upgrade', towerId: tower.id });
    expect(mobilized.turn.actionsRemaining).toBe(0);
    expect(
      end(choose(state, 'mobilization')).effects.some(
        (e) => e.cardId === 'mobilization',
      ),
    ).toBe(false);
  });
  it('Fresh Foundations modifies one normal build and Momentum only the first normal operation', () => {
    const state = setup(),
      origin = own(state).cells[0]!,
      cell = { x: origin.x, y: origin.y + 1 },
      second = { x: origin.x, y: origin.y + 2 };
    let next = run(choose(state, 'fresh_foundations'), { type: 'build', cell });
    expect(towerAt(next, cell)!.health).toBe(2);
    expect(next.turn.actionsRemaining).toBe(1);
    next = run(next, { type: 'build', cell: second });
    expect(towerAt(next, second)!.health).toBe(1);
    expect(
      towerAt(run(choose(state, 'momentum'), { type: 'build', cell }), cell)!
        .health,
    ).toBe(2);
    const expanded = run(choose(state, 'momentum'), {
      type: 'expand',
      towerId: own(state).id,
      cell,
    });
    expect(own(expanded).health).toBe(4);
    const upgraded = run(choose(state, 'momentum'), {
      type: 'upgrade',
      towerId: own(state).id,
    });
    expect(upgraded.effects.some((e) => e.cardId === 'momentum')).toBe(false);
    expect(towerAt(run(upgraded, { type: 'build', cell }), cell)!.health).toBe(
      1,
    );
  });
  it.each(['ambush', 'blitzkrieg'])(
    '%s preserves charges on misses and deals two on hits',
    (id) => {
      const state = setup(),
        target = enemy(state),
        origin = target.cells[0]!;
      target.health = 10;
      let next = run(choose(state, id), {
        type: 'attack',
        cell: { x: origin.x + 2, y: origin.y + 2 },
      });
      expect(next.effects.find((e) => e.cardId === id)!.remainingCharges).toBe(
        id === 'ambush' ? 1 : 2,
      );
      next = run(next, { type: 'attack', cell: origin });
      expect(next.towers.find((t) => t.id === target.id)!.health).toBe(8);
    },
  );
  it('adds Ambush and Weak Point bonuses and tracks Focused Fire separately per tower', () => {
    const state = setup(),
      target = enemy(state),
      other = state.towers.find(
        (t) => t.ownerId !== state.turn.playerId && t.id !== target.id,
      )!;
    target.health = 10;
    other.health = 10;
    const ambushed = choose(choose(state, 'ambush'), 'weak_point', {
      tower: target.id,
    });
    expect(
      run(ambushed, { type: 'attack', cell: target.cells[0]! }).towers.find(
        (t) => t.id === target.id,
      )!.health,
    ).toBe(7);
    let focused = choose(state, 'focused_fire');
    focused.turn.actionsRemaining = 4;
    focused = run(focused, { type: 'attack', cell: target.cells[0]! });
    focused = run(focused, { type: 'attack', cell: other.cells[0]! });
    focused = run(focused, { type: 'attack', cell: target.cells[0]! });
    focused = run(focused, { type: 'attack', cell: other.cells[0]! });
    expect(focused.towers.find((t) => t.id === target.id)!.health).toBe(7);
    expect(focused.towers.find((t) => t.id === other.id)!.health).toBe(7);
    expect(end(focused).effects.some((e) => e.cardId === 'focused_fire')).toBe(
      false,
    );
  });
  it.each([
    ['chain_reaction', 1],
    ['kill_chain', 2],
  ] as const)(
    '%s grants bounded free attacks, spends them first, and blocks ending early',
    (id, max) => {
      const state = setup();
      state.towers
        .filter((t) => t.ownerId !== state.turn.playerId)
        .forEach((t) => (t.health = 1));
      let next = run(choose(state, id), {
        type: 'attack',
        cell: enemy(state).cells[0]!,
      });
      expect(next.turn.freeAttacksAvailable).toBe(1);
      expect(next.turn.actionsRemaining).toBe(1);
      expect(
        applyCommand(
          { ...next, turn: { ...next.turn, actionsRemaining: 0 } },
          next.turn.playerId,
          { type: 'end_turn' },
          next.lastCommandAt,
          defaultRegistry,
        ).ok,
      ).toBe(false);
      next = run(next, { type: 'attack', cell: enemy(next).cells[0]! });
      expect(next.turn.actionsRemaining).toBe(1);
      expect(next.turn.freeAttacksAvailable).toBe(max === 2 ? 1 : 0);
      if (max === 2)
        next = run(next, { type: 'attack', cell: enemy(next).cells[0]! });
      expect(next.turn.freeAttacksAvailable ?? 0).toBe(0);
      expect(next.effects.some((e) => e.cardId === id)).toBe(false);
    },
  );
  it.each(['reinforced_walls', 'barricade'])(
    '%s shield exhausts correctly and expires at owner turn',
    (id) => {
      const state = setup(),
        tower = own(state),
        amount = id === 'barricade' ? 2 : 1;
      let next = end(choose(state, id, { tower: tower.id }));
      next.players
        .find((p) => p.id === next.turn.playerId)!
        .revealed.push(cellKey(tower.cells[0]!));
      next = choose(next, 'heavy_artillery', { tower: tower.id });
      expect(next.towers.find((t) => t.id === tower.id)?.health ?? 0).toBe(
        3 - (3 - amount),
      );
    },
  );
  it('Impenetrable prevents card and attack damage without spending shield points and still reveals attacks', () => {
    let state = setup();
    const tower = own(state);
    tower.health = 5;
    state = end(
      choose(choose(state, 'barricade', { tower: tower.id }), 'impenetrable', {
        tower: tower.id,
      }),
    );
    const owner = state.players.find((p) => p.id === state.turn.playerId)!;
    owner.revealed.push(cellKey(tower.cells[0]!));
    state = choose(state, 'heavy_artillery', { tower: tower.id });
    expect(state.towers.find((t) => t.id === tower.id)!.health).toBe(5);
    state = run(state, { type: 'attack', cell: tower.cells[0]! });
    expect(state.towers.find((t) => t.id === tower.id)!.health).toBe(5);
    expect(
      state.effects.find((e) => e.cardId === 'barricade')!.shieldRemaining,
    ).toBe(2);
    expect(
      state.players.find((p) => p.id === state.turn.playerId)!.revealed,
    ).toContain(cellKey(tower.cells[0]!));
  });
  it('Counterintelligence ignores misses, triggers on prevented hits, and reveals deterministic hidden cells once', () => {
    let state = setup();
    const tower = own(state),
      defender = state.turn.playerId;
    state = end(
      choose(choose(state, 'counterintelligence'), 'impenetrable', {
        tower: tower.id,
      }),
    );
    const before = state.players.find((p) => p.id === defender)!.revealed
      .length;
    state = choose(state, 'spotter');
    const attacker = state.players.find((p) => p.id === state.turn.playerId)!;
    state = run(state, {
      type: 'attack',
      cell: { x: tower.cells[0]!.x + 2, y: tower.cells[0]!.y + 2 },
    });
    expect(state.players.find((p) => p.id === defender)!.revealed).toHaveLength(
      before,
    );
    const hit = run(state, { type: 'attack', cell: tower.cells[0]! });
    expect(hit).toEqual(
      run(copy(state), { type: 'attack', cell: tower.cells[0]! }),
    );
    expect(hit.players.find((p) => p.id === defender)!.revealed.length).toBe(
      before + 1,
    );
    const added = hit.players.find((p) => p.id === defender)!.revealed.at(-1)!;
    expect(
      quadrantCells(state.preset, attacker.quadrant).map(cellKey),
    ).toContain(added);
    expect(hit.effects.some((e) => e.cardId === 'counterintelligence')).toBe(
      false,
    );
  });
  it('Phoenix ignores loss of a non-final tower, saves the last at exactly 3 once, then permits elimination', () => {
    let state = setup();
    const ownerId = state.turn.playerId,
      tower = own(state),
      spare = state.towers.find((t) => t.id === 'spare')!;
    tower.health = 1;
    state = end(choose(state, 'phoenix_protocol'));
    state = hitOwner(state, spare.id);
    expect(state.towers.some((t) => t.id === spare.id)).toBe(false);
    expect(state.effects.some((e) => e.cardId === 'phoenix_protocol')).toBe(
      true,
    );
    state.players
      .find((p) => p.id === state.turn.playerId)!
      .revealed.push(cellKey(tower.cells[0]!));
    state = choose(state, 'heavy_artillery', { tower: tower.id });
    expect(state.towers.find((t) => t.id === tower.id)!.health).toBe(3);
    expect(state.players.find((p) => p.id === ownerId)!.eliminated).toBe(false);
    expect(state.effects.some((e) => e.cardId === 'phoenix_protocol')).toBe(
      false,
    );
    state = choose(state, 'heavy_artillery', { tower: tower.id });
    expect(state.towers.some((t) => t.id === tower.id)).toBe(false);
    expect(state.players.find((p) => p.id === ownerId)!.eliminated).toBe(true);
  });
  it.each([
    'reinforced_walls',
    'barricade',
    'impenetrable',
    'phoenix_protocol',
  ])('%s expires at the beginning of its owner’s next turn', (id) => {
    let state = setup();
    state = choose(state, id);
    const ownerId = state.turn.playerId;
    for (let i = 0; i < 4; i++) {
      if (i > 0) state = choose(state, 'spotter');
      state = end(state);
    }
    expect(state.turn.playerId).toBe(ownerId);
    expect(state.effects.some((e) => e.cardId === id)).toBe(false);
  });
});

it.each([
  'field_repairs',
  'repair_crew',
  'fortress',
  'engineering_crew',
  'master_architect',
  'ascension',
  'fortification_protocol',
  'reinforcement_protocol',
])('%s caps all healing at 10', (id) => {
  const state = setup();
  state.towers
    .filter((t) => t.ownerId === state.turn.playerId)
    .forEach((t) => (t.health = 9));
  const next = choose(state, id);
  expect(
    next.towers
      .filter((t) => t.ownerId === next.turn.playerId)
      .every((t) => t.health <= 10),
  ).toBe(true);
  expect(
    next.towers.some(
      (t) => t.ownerId === next.turn.playerId && t.health === 10,
    ),
  ).toBe(true);
});
it('finishes immediately when a direct card destroys the final opponent tower', () => {
  const state = setup(),
    ownerId = state.turn.playerId,
    target = enemy(state);
  state.towers = state.towers.filter(
    (t) => t.ownerId === ownerId || t.id === target.id,
  );
  target.health = 2;
  state.players.forEach((p) => {
    if (p.id !== ownerId && p.id !== target.ownerId) p.eliminated = true;
  });
  const next = choose(state, 'precision_strike', { tower: target.id });
  expect(next.result?.reason).toBe('last_survivor');
  expect(next.result?.winnerId).toBe(ownerId);
  expect(next.turn.actionsRemaining).toBe(2);
  expect(next.players.find((p) => p.id === target.ownerId)!.eliminated).toBe(
    true,
  );
});
it('area damage finishes all distinct victims before eliminating their owner', () => {
  const state = setup(),
    target = enemy(state),
    origin = target.cells[0]!;
  target.health = 1;
  state.towers.push({
    id: 'area-second',
    ownerId: target.ownerId,
    type: 'normal',
    cells: [{ x: origin.x + 1, y: origin.y }],
    health: 1,
  });
  const next = choose(state, 'air_strike', { cell: origin });
  const damage = next.history.filter((e) => e.type === 'damage_resolved');
  expect(damage).toHaveLength(2);
  expect(damage.map((e) => e.details.towerId)).toEqual([
    'area-second',
    target.id,
  ]);
  const elimination = next.history.find(
    (e) => e.type === 'eliminated' && e.playerId === target.ownerId,
  )!;
  expect(elimination.sequence).toBeGreaterThan(damage[1]!.sequence);
});
it('Counterintelligence harmlessly consumes its charge when the attacker quadrant is fully revealed', () => {
  let state = setup();
  const defender = state.turn.playerId,
    tower = own(state);
  state.players.find((p) => p.id === defender)!.revealed = state.players
    .filter((p) => p.id !== defender)
    .flatMap((p) => quadrantCells(state.preset, p.quadrant).map(cellKey));
  state = end(choose(state, 'counterintelligence'));
  const before = state.players.find((p) => p.id === defender)!.revealed;
  state = hitOwner(state, tower.id);
  expect(state.players.find((p) => p.id === defender)!.revealed).toEqual(
    before,
  );
  expect(state.effects.some((e) => e.cardId === 'counterintelligence')).toBe(
    false,
  );
});
it('free Build and Expand reject ordinary illegality without consuming the offer or RNG', () => {
  const state = setup();
  for (const [id, targets] of [
    ['rapid_construction', { cells: [own(state).cells[0]!] }],
    [
      'rapid_expansion',
      { tower: own(state).id, cells: [enemy(state).cells[0]!] },
    ],
  ] as [string, Record<string, TargetValue>][]) {
    const input = copy(state);
    input.turn.cardOffer = [id, 'neutral_reserve', 'neutral_patience'];
    const result = applyCommand(
      input,
      input.turn.playerId,
      { type: 'select_card', cardId: id, targets },
      input.lastCommandAt,
      defaultRegistry,
    );
    expect(result.ok).toBe(false);
    expect(result.state).toBe(input);
    expect(result.state.rngState).toBe(input.rngState);
    expect(result.state.turn.selectedCardId).toBeNull();
  }
});
it('replaces offers invalidated by an intervening forfeit with deterministic neutral cards before persistence', () => {
  const state = setup(),
    target = enemy(state),
    owner = state.players.find((p) => p.id === state.turn.playerId)!;
  owner.revealed = [cellKey(target.cells[0]!)];
  state.turn.cardOffer = ['weak_point', 'precision_strike', 'heavy_artillery'];
  const next = run(state, { type: 'forfeit', playerId: target.ownerId });
  expect(next.turn.cardOffer).toEqual(launchCatalog.fallbackCardIds);
  expect(next.rngState).toBe(state.rngState);
  expect(run(next, { type: 'timeout' }).turn.number).toBe(
    state.turn.number + 1,
  );
  expect(next).toEqual(
    run(copy(state), { type: 'forfeit', playerId: target.ownerId }),
  );
});

it('rejects stale launch rules text and invalid target/effect metadata during registration', () => {
  for (const invalid of [
    (c: typeof launchCatalog) => {
      c.cards.find((c) => c.id === 'field_repairs')!.description =
        'Give one damaged tower +7 health.';
    },
    (c: typeof launchCatalog) => {
      c.cards.find((c) => c.id === 'scout_drone')!.targets[0]!.size = 0;
    },
    (c: typeof launchCatalog) => {
      c.cards.find((c) => c.id === 'surveyor')!.targets[0]!.count = 4;
    },
    (c: typeof launchCatalog) => {
      const effect = c.cards.find((c) => c.id === 'rapid_construction')!
        .effects[0]!;
      if (effect.type === 'build_free') effect.health = 11;
    },
  ]) {
    const broken = copy(launchCatalog);
    invalid(broken);
    expect(() => createRegistry([broken], [launchBalance])).toThrow();
  }
});
