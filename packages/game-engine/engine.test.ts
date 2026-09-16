import { describe, expect, it } from 'vitest';
import {
  adjacent,
  allCells,
  applyCommand,
  cellKey,
  coordinateLabel,
  createMatch,
  defaultRegistry,
  determineResult,
  generateOffer,
  inBounds,
  legalTargets,
  normalizedProgress,
  ownsCell,
  PRESETS,
  projectMatch,
  quadrantAt,
  quadrantCells,
  QUADRANTS,
  scoreMatch,
  towerAt,
  towerPoints,
  TURN_DURATION_MS,
} from './src/index.js';
import type {
  Command,
  EngineRegistry,
  MatchState,
  PresetId,
} from './src/index.js';

export function setup(
  preset: PresetId = 'small',
  seed = 123,
  registry = defaultRegistry,
): MatchState {
  return createMatch(
    {
      id: 'match',
      playerIds: ['a', 'b', 'c', 'd'],
      preset,
      seed,
      now: 1000,
      cardCatalogVersion: 'framework-1',
      balanceVersion: 'framework-1',
    },
    registry,
  );
}
export function accept(
  state: MatchState,
  command: Command,
  registry: EngineRegistry = defaultRegistry,
  actor: string | null = state.turn.playerId,
  now = state.lastCommandAt,
): MatchState {
  const result = applyCommand(state, actor, command, now, registry);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}
export function chooseNeutral(state: MatchState): MatchState {
  state = JSON.parse(JSON.stringify(state)) as MatchState;
  state.turn.cardOffer = ['neutral-a', 'neutral-b', 'neutral-c'];
  return accept(state, {
    type: 'select_card',
    cardId: 'neutral-a',
    targets: {},
  });
}
function reject(
  state: MatchState,
  command: Command,
  actor = state.turn.playerId,
  now = state.lastCommandAt,
) {
  const before = JSON.stringify(state);
  const result = applyCommand(state, actor, command, now, defaultRegistry);
  expect(result.ok).toBe(false);
  expect(result.state).toBe(state);
  expect(JSON.stringify(state)).toBe(before);
}
const owner = (s: MatchState) =>
  s.players.find((p) => p.id === s.turn.playerId)!;
const ownTower = (s: MatchState) =>
  s.towers.find((t) => t.ownerId === s.turn.playerId)!;
const emptyOwn = (s: MatchState) =>
  quadrantCells(s.preset, owner(s).quadrant).find((c) => !towerAt(s, c))!;
const enemy = (s: MatchState) =>
  s.towers.find((t) => t.ownerId !== s.turn.playerId)!;

describe('presets and deterministic setup', () => {
  it.each(Object.keys(PRESETS) as PresetId[])(
    '%s dimensions, boundaries and Town Halls',
    (preset) => {
      const state = setup(preset);
      const config = PRESETS[preset];
      expect(allCells(preset)).toHaveLength(config.boardSize ** 2);
      expect(new Set(state.players.map((p) => p.quadrant)).size).toBe(4);
      expect(new Set(state.turnOrder).size).toBe(4);
      expect(state.towers).toHaveLength(4);
      for (const p of state.players) {
        const tower = state.towers.find((t) => t.ownerId === p.id)!;
        expect(tower.health).toBe(3);
        expect(tower.type).toBe('town_hall');
        expect(tower.cells).toHaveLength(1);
        expect(quadrantAt(preset, tower.cells[0]!)).toBe(p.quadrant);
        expect(p.revealed).toEqual([]);
        expect(p.cardsSelected).toEqual({});
      }
      for (const q of QUADRANTS) {
        const cells = quadrantCells(preset, q);
        expect(cells).toHaveLength(config.quadrantSize ** 2);
        expect(cells.every((c) => quadrantAt(preset, c) === q)).toBe(true);
      }
      for (const cell of [
        { x: -1, y: 0 },
        { x: 0.5, y: 0 },
        { x: config.boardSize, y: 0 },
        { x: 0, y: config.boardSize },
        { x: NaN, y: 0 },
      ])
        expect(inBounds(preset, cell)).toBe(false);
      expect(state.effects).toEqual([]);
      expect(state.turn.deadline).toBe(1000 + TURN_DURATION_MS);
      expect(state.turn.actionsRemaining).toBe(2);
      expect(state).toEqual(setup(preset));
      expect(state).not.toEqual(setup(preset, 456));
    },
  );
  it('rejects invalid player counts, seeds, presets and timestamps', () => {
    const input = {
      id: 'm',
      playerIds: ['a', 'b', 'c', 'd'],
      preset: 'small' as const,
      seed: 1,
      now: 0,
      cardCatalogVersion: 'framework-1',
      balanceVersion: 'framework-1',
    };
    for (const patch of [
      { playerIds: ['a', 'b'] },
      { playerIds: ['a', 'a', 'b', 'c'] },
      { playerIds: ['', 'a', 'b', 'c'] },
      { seed: -1 },
      { seed: 1.5 },
      { now: NaN },
      { cardCatalogVersion: 'missing' },
    ])
      expect(() =>
        createMatch({ ...input, ...patch }, defaultRegistry),
      ).toThrow();
    expect(() =>
      createMatch({ ...input, preset: 'unknown' as PresetId }, defaultRegistry),
    ).toThrow();
  });
  it('supports column labels beyond Z and orthogonal adjacency only', () => {
    expect(coordinateLabel({ x: 0, y: 0 })).toBe('A1');
    expect(coordinateLabel({ x: 27, y: 27 })).toBe('AB28');
    expect(adjacent({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
    expect(adjacent({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
  });
});

describe('actions and atomic rejection', () => {
  it('requires a card, the active actor, valid clock and exactly two actions', () => {
    let state = setup();
    reject(state, { type: 'build', cell: emptyOwn(state) });
    reject(state, { type: 'select_card', cardId: 'not-offered', targets: {} });
    state = chooseNeutral(state);
    reject(state, { type: 'select_card', cardId: 'neutral-b', targets: {} });
    reject(state, { type: 'end_turn' });
    reject(
      state,
      { type: 'upgrade', towerId: ownTower(state).id },
      enemy(state).ownerId,
    );
    reject(
      state,
      { type: 'upgrade', towerId: ownTower(state).id },
      state.turn.playerId,
      state.turn.deadline,
    );
    reject(
      state,
      { type: 'upgrade', towerId: ownTower(state).id },
      state.turn.playerId,
      999,
    );
    state = accept(state, { type: 'upgrade', towerId: ownTower(state).id });
    reject(state, { type: 'end_turn' });
    state = accept(state, { type: 'upgrade', towerId: ownTower(state).id });
    expect(ownTower(state).health).toBe(5);
    reject(state, { type: 'upgrade', towerId: ownTower(state).id });
    const next = accept(state, { type: 'end_turn' });
    expect(next.turn.playerId).toBe(state.turnOrder[1]);
    expect(next.turn.actionsRemaining).toBe(2);
    expect(next.turn.selectedCardId).toBeNull();
  });
  it('builds separate towers even beside existing towers', () => {
    let state = chooseNeutral(setup());
    const tower = ownTower(state);
    const cell = quadrantCells(state.preset, owner(state).quadrant).find((c) =>
      adjacent(c, tower.cells[0]!),
    )!;
    state = accept(state, { type: 'build', cell });
    expect(towerAt(state, cell)).toMatchObject({
      health: 1,
      type: 'normal',
      cells: [cell],
    });
    expect(towerAt(state, cell)!.id).not.toBe(tower.id);
    expect(state.towers).toHaveLength(5);
    reject(state, { type: 'build', cell });
    reject(state, { type: 'build', cell: enemy(state).cells[0]! });
  });
  it('expands without merging or changing health', () => {
    let state = chooseNeutral(setup());
    const cells = quadrantCells(state.preset, owner(state).quadrant);
    const left = cells[0]!;
    const middle = cells[1]!;
    const right = cells[2]!;
    state.towers = state.towers.filter(
      (t) => t.ownerId !== state.turn.playerId,
    );
    state.towers.push(
      {
        id: 'left',
        ownerId: state.turn.playerId,
        cells: [left],
        health: 4,
        type: 'normal',
      },
      {
        id: 'right',
        ownerId: state.turn.playerId,
        cells: [right],
        health: 2,
        type: 'normal',
      },
    );
    reject(state, {
      type: 'expand',
      towerId: 'left',
      cell: { x: left.x + 1, y: left.y + 1 },
    });
    reject(state, { type: 'expand', towerId: 'left', cell: right });
    reject(state, {
      type: 'expand',
      towerId: 'left',
      cell: enemy(state).cells[0]!,
    });
    state = accept(state, { type: 'expand', towerId: 'left', cell: middle });
    expect(state.towers.find((t) => t.id === 'left')).toMatchObject({
      cells: [left, middle],
      health: 4,
    });
    expect(state.towers.find((t) => t.id === 'right')!.cells).toEqual([right]);
  });
  it('enforces ownership, collision, quadrant edge and health cap', () => {
    let state = chooseNeutral(setup());
    ownTower(state).health = 9;
    state = accept(state, { type: 'upgrade', towerId: ownTower(state).id });
    expect(ownTower(state).health).toBe(10);
    reject(state, { type: 'upgrade', towerId: ownTower(state).id });
    reject(state, { type: 'upgrade', towerId: enemy(state).id });
    reject(state, {
      type: 'expand',
      towerId: enemy(state).id,
      cell: emptyOwn(state),
    });
    reject(state, { type: 'attack', cell: emptyOwn(state) });
    reject(state, { type: 'attack', cell: { x: 12, y: 0 } });
    reject(state, { type: 'attack', cell: { x: 1.1, y: 2 } });
    const edge = quadrantCells(state.preset, owner(state).quadrant).find(
      (c) => c.x === 5 || c.x === 6,
    )!;
    ownTower(state).cells = [edge];
    reject(state, {
      type: 'expand',
      towerId: ownTower(state).id,
      cell: { x: edge.x === 5 ? 6 : 5, y: edge.y },
    });
  });
  it('applies shared damage, repeated attacks and whole-tower destruction without footprint reveal', () => {
    let state = chooseNeutral(setup());
    const target = enemy(state);
    const cells = quadrantCells(
      state.preset,
      state.players.find((p) => p.id === target.ownerId)!.quadrant,
    );
    target.cells = [cells[0]!, cells[1]!];
    target.health = 2;
    const id = target.id;
    state = accept(state, { type: 'attack', cell: cells[0]! });
    expect(towerAt(state, cells[1]!)!.health).toBe(1);
    state = accept(state, { type: 'attack', cell: cells[0]! });
    expect(state.towers.some((t) => t.id === id)).toBe(false);
    expect(owner(state).revealed).toEqual([cellKey(cells[0]!)]);
    expect(
      projectMatch(state, state.turn.playerId).cells.find(
        (c) => cellKey(c.cell) === cellKey(cells[1]!),
      )!.visibility,
    ).toBe('hidden');
    expect(
      projectMatch(state, state.turn.playerId).cells.find(
        (c) => cellKey(c.cell) === cellKey(cells[0]!),
      ),
    ).toMatchObject({ visibility: 'visible', tower: null });
    expect(state.players.find((p) => p.id === target.ownerId)!.eliminated).toBe(
      true,
    );
  });
  it('Town Hall loss is ordinary tower loss while another tower survives', () => {
    let state = chooseNeutral(setup());
    const target = enemy(state);
    target.health = 1;
    const spare = quadrantCells(
      state.preset,
      state.players.find((p) => p.id === target.ownerId)!.quadrant,
    ).find((c) => !towerAt(state, c))!;
    state.towers.push({
      id: 'spare',
      ownerId: target.ownerId,
      type: 'normal',
      health: 1,
      cells: [spare],
    });
    state = accept(state, { type: 'attack', cell: target.cells[0]! });
    expect(state.players.find((p) => p.id === target.ownerId)!.eliminated).toBe(
      false,
    );
    expect(state.result).toBeNull();
  });
  it('accepts misses and leaves all input objects unchanged', () => {
    const state = chooseNeutral(setup());
    const cell = allCells(state.preset).find(
      (c) => !ownsCell(state, owner(state), c) && !towerAt(state, c),
    )!;
    const before = JSON.stringify(state);
    const next = accept(state, { type: 'attack', cell });
    expect(JSON.stringify(state)).toBe(before);
    cell.x = -10;
    expect(next.history.at(-1)!.details.outcome).toBe('miss');
    expect(next.turn.actionsRemaining).toBe(1);
  });
  it('rejects malformed runtime commands atomically', () => {
    const state = chooseNeutral(setup());
    for (const command of [
      null,
      {},
      { type: 'pass' },
      { type: 'build' },
      { type: 'attack', cell: null },
      { type: 'select_card', targets: null },
    ])
      reject(state, command as Command);
  });
});

describe('turns, timeout and endings', () => {
  it.each(Object.keys(PRESETS) as PresetId[])(
    'completes exactly the configured rounds on %s',
    (preset) => {
      let state = setup(preset);
      let turns = 0;
      while (!state.result) {
        state = chooseNeutral(state);
        state = accept(state, { type: 'build', cell: emptyOwn(state) });
        state = accept(state, { type: 'build', cell: emptyOwn(state) });
        state = accept(state, { type: 'end_turn' });
        turns++;
      }
      expect(turns).toBe(PRESETS[preset].rounds * 4);
      expect(state.turn.round).toBe(PRESETS[preset].rounds);
      expect(state.result.reason).toBe('round_limit');
      reject(state, { type: 'end_turn' });
    },
  );
  it('skips eliminated players and wraps rounds when the last seat is eliminated', () => {
    let state = chooseNeutral(setup());
    const skipped = state.turnOrder[1]!;
    const last = state.turnOrder[3]!;
    state.players
      .filter((p) => [skipped, last].includes(p.id))
      .forEach((p) => {
        p.eliminated = true;
      });
    state.towers = state.towers.filter(
      (t) => ![skipped, last].includes(t.ownerId),
    );
    for (let i = 0; i < 2; i++)
      state = accept(state, { type: 'build', cell: emptyOwn(state) });
    state = accept(state, { type: 'end_turn' });
    expect(state.turn.playerId).toBe(state.turnOrder[2]);
    state = chooseNeutral(state);
    for (let i = 0; i < 2; i++)
      state = accept(state, { type: 'build', cell: emptyOwn(state) });
    state = accept(state, { type: 'end_turn' });
    expect(state.turn.playerId).toBe(state.turnOrder[0]);
    expect(state.turn.round).toBe(2);
  });
  it('ends immediately on the first action when only one player survives', () => {
    let state = chooseNeutral(setup());
    const target = enemy(state);
    target.health = 1;
    for (const p of state.players)
      if (p.id !== state.turn.playerId && p.id !== target.ownerId)
        p.eliminated = true;
    state.towers = state.towers.filter(
      (t) => !state.players.find((p) => p.id === t.ownerId)!.eliminated,
    );
    state = accept(state, { type: 'attack', cell: target.cells[0]! });
    expect(state.result).toMatchObject({
      winnerId: state.turn.playerId,
      reason: 'last_survivor',
    });
    expect(state.turn.actionsRemaining).toBe(1);
  });
  it('timeout is server-only, starts at the deadline, resolves saved offers and remaining actions', () => {
    let state = setup();
    expect(
      applyCommand(
        state,
        null,
        { type: 'timeout' },
        state.turn.deadline - 1,
        defaultRegistry,
      ).ok,
    ).toBe(false);
    expect(
      applyCommand(
        state,
        state.turn.playerId,
        { type: 'timeout' },
        state.turn.deadline,
        defaultRegistry,
      ).ok,
    ).toBe(false);
    const before = JSON.stringify(state);
    const next = accept(
      state,
      { type: 'timeout' },
      defaultRegistry,
      null,
      state.turn.deadline,
    );
    expect(JSON.stringify(state)).toBe(before);
    expect(
      next.players.find((p) => p.id === state.turn.playerId)!.timedOutTurns,
    ).toBe(1);
    expect(next.history.filter((e) => e.type === 'attack')).toHaveLength(2);
    expect(
      next.history.find((e) => e.type === 'card_selected')!.details.cardId,
    ).toBeOneOf(state.turn.cardOffer);
    expect(next.turn.deadline).toBe(state.turn.deadline + TURN_DURATION_MS);
    state = chooseNeutral(state);
    state = accept(state, { type: 'build', cell: emptyOwn(state) });
    const partial = accept(
      state,
      { type: 'timeout' },
      defaultRegistry,
      null,
      state.turn.deadline,
    );
    expect(partial.history.filter((e) => e.type === 'attack')).toHaveLength(1);
    expect(
      partial.history.filter((e) => e.type === 'card_selected'),
    ).toHaveLength(1);
  });
  it.each(Object.keys(PRESETS) as PresetId[])(
    'timeout replay survives JSON restore and completes %s',
    (preset) => {
      let state = setup(preset, 9876);
      let count = 0;
      while (!state.result) {
        const restored = JSON.parse(JSON.stringify(state)) as MatchState;
        const next = accept(
          state,
          { type: 'timeout' },
          defaultRegistry,
          null,
          state.turn.deadline,
        );
        expect(
          accept(
            restored,
            { type: 'timeout' },
            defaultRegistry,
            null,
            restored.turn.deadline,
          ),
        ).toEqual(next);
        state = next;
        expect(++count).toBeLessThanOrEqual(PRESETS[preset].rounds * 4);
      }
      expect(state.result.winnerId).toBeTruthy();
    },
  );
});

describe('scoring', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 5],
    [4, 8],
    [5, 10],
    [6, 12],
    [7, 14],
    [8, 16],
    [20, 40],
  ])('size %i scores %i', (size, points) =>
    expect(towerPoints(size!)).toBe(points),
  );
  it('rejects invalid sizes', () => {
    for (const n of [0, -1, 1.5, NaN]) expect(() => towerPoints(n)).toThrow();
  });
  it('scores surviving towers, ignores health/type points and excludes eliminated players', () => {
    const state = setup();
    state.towers[0]!.health = 10;
    state.towers[0]!.type = 'normal';
    const scores = scoreMatch(state);
    expect(scores.every((s) => s.points === 1)).toBe(true);
    state.players[0]!.eliminated = true;
    expect(scoreMatch(state)[0]!.points).toBe(0);
    expect(determineResult(state, 'round_limit').winnerId).not.toBe(
      state.players[0]!.id,
    );
  });
  it.each(['health', 'town_hall', 'timeouts', 'turn_order'] as const)(
    'applies %s in documented order',
    (criterion) => {
      const state = setup();
      const winner =
        criterion === 'turn_order' ? state.turnOrder[0]! : state.turnOrder[3]!;
      if (criterion === 'health')
        state.towers.find((t) => t.ownerId === winner)!.health = 4;
      if (criterion === 'town_hall')
        state.towers.forEach((t) => {
          if (t.ownerId !== winner) t.type = 'normal';
        });
      if (criterion === 'timeouts')
        state.players.forEach((p) => {
          if (p.id !== winner) p.timedOutTurns = 1;
        });
      const result = determineResult(state, 'round_limit');
      expect(result.winnerId).toBe(winner);
      expect(result.tieBreakers.at(-1)!.criterion).toBe(criterion);
      expect(result.tieBreakers.at(-1)!.remainingPlayerIds).toEqual([winner]);
      expect(result.scores.every((s) => s.towers.length === 1)).toBe(true);
    },
  );
});

describe('fog and view projection', () => {
  it('projects only own contents, private offers and allowlisted public fields', () => {
    const state = setup();
    for (const player of state.players) {
      const view = projectMatch(state, player.id);
      expect(view.cells.filter((c) => c.visibility === 'visible')).toHaveLength(
        36,
      );
      expect('seed' in view).toBe(false);
      expect('rngState' in view).toBe(false);
      expect('towers' in view).toBe(false);
      expect('cardOffer' in view.turn).toBe(player.id === state.turn.playerId);
      expect(JSON.stringify(view)).not.toContain('cardsSelected');
    }
    expect(() => projectMatch(state, 'spectator')).toThrow();
  });
  it('revealed cells stay live through construction, expansion, damage and destruction', () => {
    let state = chooseNeutral(setup());
    const observer = enemy(state).ownerId;
    const cell = emptyOwn(state);
    state.players.find((p) => p.id === observer)!.revealed.push(cellKey(cell));
    state = accept(state, { type: 'build', cell });
    const view = projectMatch(state, observer);
    expect(
      view.cells.find((c) => cellKey(c.cell) === cellKey(cell))!,
    ).toMatchObject({ tower: { health: 1, ownerId: state.turn.playerId } });
    expect(view.history.find((e) => e.type === 'build')).not.toHaveProperty(
      'details',
    );
    const tower = towerAt(state, cell)!;
    const hidden = quadrantCells(state.preset, owner(state).quadrant).find(
      (c) => adjacent(c, cell) && !towerAt(state, c),
    )!;
    state = accept(state, { type: 'expand', towerId: tower.id, cell: hidden });
    const projected = projectMatch(state, observer);
    expect(
      projected.cells.find((c) => cellKey(c.cell) === cellKey(hidden))!
        .visibility,
    ).toBe('hidden');
    const visibleTower = projected.cells.find(
      (c) => cellKey(c.cell) === cellKey(cell),
    )!;
    expect(visibleTower).not.toHaveProperty('tower.cells');
    expect(visibleTower).not.toHaveProperty('tower.size');
    towerAt(state, cell)!.health = 7;
    expect(
      projectMatch(state, observer).cells.find(
        (c) => cellKey(c.cell) === cellKey(cell),
      ),
    ).toMatchObject({ tower: { health: 7 } });
  });
  it('public attack messages omit cell, outcome, health and tower identity', () => {
    let state = chooseNeutral(setup());
    const target = enemy(state);
    state = accept(state, { type: 'attack', cell: target.cells[0]! });
    for (const p of state.players.filter((p) => p.id !== state.turn.playerId))
      expect(
        projectMatch(state, p.id).history.find((e) => e.type === 'attack'),
      ).not.toHaveProperty('details');
    expect(
      projectMatch(state, state.turn.playerId).history.find(
        (e) => e.type === 'attack',
      )!.details,
    ).toMatchObject({ outcome: 'hit' });
  });
  it('eliminated players retain only existing visibility; end reveals full board and history', () => {
    const state = setup();
    const player = state.players[0]!;
    player.eliminated = true;
    state.towers = state.towers.filter((t) => t.ownerId !== player.id);
    const cell = allCells(state.preset).find(
      (c) => !ownsCell(state, player, c),
    )!;
    player.revealed.push(cellKey(cell));
    expect(
      projectMatch(state, player.id).cells.filter(
        (c) => c.visibility === 'visible',
      ),
    ).toHaveLength(37);
    state.result = determineResult(state, 'round_limit');
    const view = projectMatch(state, player.id);
    expect(view.cells.every((c) => c.visibility === 'visible')).toBe(true);
    expect(view.history.map((e) => e.details)).toEqual(
      state.history.map((e) => e.details),
    );
    view.players[0]!.id = 'mutated';
    view.history[0]!.details!.changed = true;
    expect(state.players[0]!.id).not.toBe('mutated');
    expect(state.history[0]!.details).not.toHaveProperty('changed');
  });
});

describe('offers and progress', () => {
  it.each(Object.keys(PRESETS) as PresetId[])(
    'normalizes %s progression',
    (preset) => {
      const state = setup(preset);
      expect(normalizedProgress(state)).toBe(0);
      state.turn.round = PRESETS[preset].rounds;
      expect(normalizedProgress(state)).toBe(1);
    },
  );
  it('offers are reproducible, distinct and have legal targets', () => {
    for (let seed = 0; seed < 60; seed++) {
      const state = setup('small', seed);
      const before = JSON.stringify(state);
      const offer = generateOffer(state, defaultRegistry);
      expect(generateOffer(state, defaultRegistry)).toEqual(offer);
      expect(new Set(offer.cardIds).size).toBe(3);
      for (const id of offer.cardIds) {
        const card = defaultRegistry.catalogs['framework-1']!.cards.find(
          (c) => c.id === id,
        )!;
        for (const target of card.targets)
          expect(
            legalTargets(state, state.turn.playerId, target).length,
          ).toBeGreaterThan(0);
        expect(['common', 'uncommon']).toContain(card.rarityId);
      }
      expect(JSON.stringify(state)).toBe(before);
    }
  });
});
