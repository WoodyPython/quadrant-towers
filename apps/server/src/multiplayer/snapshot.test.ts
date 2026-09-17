import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createMatch,
  defaultRegistry,
} from '@quadrant/game-engine';
import { parseSnapshot } from './snapshot.js';

function placement() {
  return createMatch(
    {
      id: randomUUID(),
      playerIds: [randomUUID(), randomUUID()],
      preset: 'small',
      seed: 12,
      now: 1000,
      cardCatalogVersion: 'framework-1',
      balanceVersion: 'framework-1',
    },
    defaultRegistry,
  );
}

function battle() {
  let state = placement();
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
