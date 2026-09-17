import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  applyCommand,
  createMatch,
  defaultRegistry,
  launchCards,
  fallbackTargets,
  quadrantCells,
  cellKey,
  projectMatch,
  type MatchState,
  type Command,
} from '@quadrant/game-engine';
import {
  matchViewSchema,
  requestSchemas,
  contentSchema,
} from '@quadrant/protocol';
import { parseSnapshot } from './snapshot.js';
const run = (s: MatchState, c: Command) => {
  const next = applyCommand(
    s,
    c.type === 'timeout' ? null : s.turn.playerId,
    c,
    c.type === 'timeout' ? s.turn.deadline : s.lastCommandAt,
    defaultRegistry,
  );
  if (!next.ok) throw new Error(next.error);
  return next.state;
};
function setup() {
  let s = createMatch(
    {
      id: randomUUID(),
      playerIds: Array.from({ length: 4 }, () => randomUUID()),
      preset: 'small',
      seed: 12,
      now: 0,
      cardCatalogVersion: 'launch-2',
      balanceVersion: 'launch-2',
    },
    defaultRegistry,
  );
  while (s.phase === 'placement')
    s = run(s, {
      type: 'place_town_hall',
      cell: quadrantCells(
        s.preset,
        s.players.find((p) => p.id === s.turn.playerId)!.quadrant,
      )[0]!,
    });
  for (const player of s.players)
    player.revealed = s.towers
      .filter((t) => t.ownerId !== player.id)
      .map((t) => cellKey(t.cells[0]!));
  return s;
}
function choose(s: MatchState, id: string) {
  const card = launchCards.find((c) => c.id === id)!;
  s = structuredClone(s);
  s.turn.cardOffer = [id, 'neutral_reserve', 'neutral_patience'];
  return run(s, {
    type: 'select_card',
    cardId: id,
    targets: fallbackTargets(s, s.turn.playerId, card),
  });
}
it.each([
  'reinforced_walls',
  'barricade',
  'impenetrable',
  'phoenix_protocol',
  'focused_fire',
  'kill_chain',
  'chain_reaction',
  'overclock',
  'time_warp',
  'mobilization',
  'expansion_plans',
  'counterintelligence',
])('recovers %s state and deterministic next transition exactly', (id) => {
  let state = setup();
  const enemy = state.towers.find((t) => t.ownerId !== state.turn.playerId)!;
  if (id === 'kill_chain' || id === 'chain_reaction') enemy.health = 1;
  state = choose(state, id);
  if (['focused_fire', 'kill_chain', 'chain_reaction'].includes(id))
    state = run(state, { type: 'attack', cell: enemy.cells[0]! });
  const recovered = parseSnapshot(
    JSON.parse(JSON.stringify(state)),
    1,
    defaultRegistry,
  );
  expect(recovered).toEqual(state);
  expect(recovered.turn.cardOffer).toEqual(state.turn.cardOffer);
  expect(recovered.rngState).toBe(state.rngState);
  expect(run(recovered, { type: 'timeout' })).toEqual(
    run(state, { type: 'timeout' }),
  );
  for (const p of state.players) {
    const { id, ...view } = projectMatch(recovered, p.id);
    expect(matchViewSchema.parse({ matchId: id, ...view })).toEqual({
      matchId: id,
      ...view,
    });
  }
});
it('persists partial shield pools without resetting them or duplicate triggers', () => {
  let state = choose(setup(), 'barricade');
  const defender = state.turn.playerId,
    tower = state.towers.find((t) => t.ownerId === defender)!;
  for (let i = 0; i < 2; i++)
    state = run(state, {
      type: 'attack',
      cell: quadrantCells(
        state.preset,
        state.players.find((p) => p.id !== defender)!.quadrant,
      )[35]!,
    });
  state = run(state, { type: 'end_turn' });
  state = choose(state, 'spotter');
  state = run(state, { type: 'attack', cell: tower.cells[0]! });
  expect(
    state.effects.find((e) => e.cardId === 'barricade')!.shieldRemaining,
  ).toBe(1);
  const recovered = parseSnapshot(
    JSON.parse(JSON.stringify(state)),
    1,
    defaultRegistry,
  );
  const damaged = run(recovered, { type: 'attack', cell: tower.cells[0]! });
  expect(damaged.towers.find((t) => t.id === tower.id)!.health).toBe(3);
  expect(damaged.effects.some((e) => e.cardId === 'barricade')).toBe(false);
  expect(damaged).toEqual(
    run(state, { type: 'attack', cell: tower.cells[0]! }),
  );
});
it.each([
  'surveyor',
  'ascension',
  'emergency_infrastructure',
  'reinforcement_protocol',
  'strategic_recon',
  'all_seeing_eye',
])('validates %s atomic targets and presentation in the protocol', (id) => {
  const state = setup(),
    card = launchCards.find((c) => c.id === id)!;
  const targets = fallbackTargets(state, state.turn.playerId, card);
  const request = {
    commandId: randomUUID(),
    matchId: state.id,
    expectedVersion: state.version,
    cardId: id,
    targets,
  };
  expect(requestSchemas['card:choose'].parse(request)).toEqual(request);
  const content = {
    cardCatalogVersion: 'launch-2',
    balanceVersion: 'launch-2',
    cards: launchCards.map((c) => ({
      id: c.id,
      version: c.version,
      name: c.name,
      description: c.description,
      rarityId: c.rarityId,
      lifecycle: c.lifecycle,
      artKey: c.artKey,
      targets: c.targets.map(
        ({ id, kind, timing, size, count, towerTarget }) => ({
          id,
          kind,
          timing,
          ...(size === undefined ? {} : { size }),
          ...(count === undefined ? {} : { count }),
          ...(towerTarget === undefined ? {} : { towerTarget }),
        }),
      ),
    })),
    rarities: defaultRegistry.balances['launch-2']!.rarities.map(
      ({ id, rank, label, icon, color }) => ({ id, rank, label, icon, color }),
    ),
  };
  expect(contentSchema.parse(content)).toEqual(content);
});
it('rejects oversized target sequences and impossible action counts on recovery', () => {
  const state = setup();
  expect(() =>
    parseSnapshot(
      { ...state, turn: { ...state.turn, actionsRemaining: 5 } },
      1,
      defaultRegistry,
    ),
  ).toThrow();
  expect(
    requestSchemas['card:choose'].safeParse({
      commandId: randomUUID(),
      matchId: state.id,
      expectedVersion: 0,
      cardId: 'ascension',
      targets: { cells: Array.from({ length: 4 }, () => ({ x: 0, y: 0 })) },
    }).success,
  ).toBe(false);
});
it('keeps offers private and exactly unchanged through recovery and repeated projections', () => {
  const state = setup(),
    saved = JSON.stringify(state),
    recovered = parseSnapshot(JSON.parse(saved), 1, defaultRegistry);
  for (let i = 0; i < 3; i++)
    for (const p of state.players) {
      const view = projectMatch(recovered, p.id);
      if (p.id === state.turn.playerId)
        expect(view.turn.cardOffer).toEqual(state.turn.cardOffer);
      else expect(view.turn).not.toHaveProperty('cardOffer');
    }
  expect(recovered).toEqual(JSON.parse(saved));
});
it('retains selected compound targets in the persisted command history without reapplying free effects', () => {
  const state = choose(setup(), 'ascension'),
    recovered = parseSnapshot(
      JSON.parse(JSON.stringify(state)),
      1,
      defaultRegistry,
    );
  const entry = state.history.find((e) => e.type === 'card_selected')!;
  expect(recovered.history.find((e) => e.sequence === entry.sequence)).toEqual(
    entry,
  );
  expect(recovered.towers).toEqual(state.towers);
  expect(recovered.turn.actionsRemaining).toBe(2);
});
