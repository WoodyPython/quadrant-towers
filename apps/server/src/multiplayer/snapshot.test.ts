import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createMatch,
  defaultRegistry,
} from '@quadrant/game-engine';
import { parseSnapshot } from './snapshot.js';

function placement(playerCount = 2) {
  return createMatch(
    {
      id: randomUUID(),
      playerIds: Array.from({ length: playerCount }, () => randomUUID()),
      preset: 'small',
      seed: 12,
      now: 1000,
      cardCatalogVersion: 'framework-1',
      balanceVersion: 'framework-1',
    },
    defaultRegistry,
  );
}

function battle(playerCount = 2) {
  let state = placement(playerCount);
  while (state.phase === 'placement') {
    const result = applyCommand(
      state,
      null,
      { type: 'timeout' },
      state.turn.deadline,
      defaultRegistry,
    );
    if (!result.ok) throw new Error('Placement timeout failed');
    state = result.state;
  }
  return state;
}

describe('snapshot compatibility', () => {
  it('loads old version 1 battle snapshots without changing match state', () => {
    const state = battle();
    const legacy: Partial<typeof state> = structuredClone(state);
    delete legacy.phase;
    expect(parseSnapshot(legacy, 1, defaultRegistry)).toEqual(state);
    expect(legacy).not.toHaveProperty('phase');
  });

  it('preserves placement snapshots rather than treating them as battle', () => {
    const state = placement();
    expect(parseSnapshot(state, 1, defaultRegistry)).toEqual(state);
  });

  it('loads a disconnect forfeit saved while another player’s turn is overdue', () => {
    const state = battle(3);
    const playerId = state.players.find(
      (p) => p.id !== state.turn.playerId,
    )!.id;
    const now = state.turn.deadline + 1;
    const forfeited = applyCommand(
      state,
      null,
      { type: 'forfeit', playerId },
      now,
      defaultRegistry,
    );
    if (!forfeited.ok) throw new Error('Forfeit failed');
    const recovered = parseSnapshot(forfeited.state, 1, defaultRegistry);
    expect(recovered).toEqual(forfeited.state);
    const timedOut = applyCommand(
      recovered,
      null,
      { type: 'timeout' },
      now,
      defaultRegistry,
    );
    if (!timedOut.ok) throw new Error('Recovered timeout failed');
    expect(parseSnapshot(timedOut.state, 1, defaultRegistry)).toEqual(
      timedOut.state,
    );
    expect(timedOut.state.turn.number).toBe(state.turn.number + 1);
  });

  it('still rejects invalid phases and invalid legacy battle state', () => {
    const state = battle();
    expect(() =>
      parseSnapshot({ ...state, phase: null }, 1, defaultRegistry),
    ).toThrow();
    const legacy: Partial<typeof state> = structuredClone(state);
    delete legacy.phase;
    legacy.turn!.cardOffer = [];
    expect(() => parseSnapshot(legacy, 1, defaultRegistry)).toThrow(
      'Invalid snapshot invariants',
    );
  });
});
