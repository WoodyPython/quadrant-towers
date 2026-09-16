import { describe, expect, it } from 'vitest';
import type { MatchView, RoomView } from '@quadrant/protocol';
import {
  cellLabel,
  coordinate,
  eventText,
  secondsLeft,
  shouldReplace,
  targetsFor,
} from './board-model';
const view: MatchView = {
  matchId: 'a',
  version: 2,
  phase: 'battle',
  preset: 'small',
  dimensions: { quadrantSize: 6, boardSize: 12, rounds: 10 },
  cardCatalogVersion: 'framework-1',
  balanceVersion: 'framework-1',
  players: [
    { id: 'me', quadrant: 'nw', eliminated: false },
    { id: 'enemy', quadrant: 'ne', eliminated: false },
  ],
  turnOrder: ['me'],
  turn: {
    playerId: 'me',
    number: 1,
    round: 1,
    deadline: 10000,
    actionsRemaining: 2,
  },
  effects: [],
  history: [],
  result: null,
  cells: [
    {
      cell: { x: 0, y: 0 },
      visibility: 'visible',
      tower: { id: 't', ownerId: 'me', type: 'town_hall', health: 3 },
    },
    { cell: { x: 1, y: 0 }, visibility: 'visible', tower: null },
    { cell: { x: 1, y: 1 }, visibility: 'visible', tower: null },
    {
      cell: { x: 2, y: 0 },
      visibility: 'visible',
      tower: { id: 'full', ownerId: 'me', type: 'normal', health: 10 },
    },
    { cell: { x: 6, y: 0 }, visibility: 'hidden' },
    { cell: { x: 7, y: 0 }, visibility: 'visible', tower: null },
    { cell: { x: 0, y: 6 }, visibility: 'hidden' },
  ],
};
describe('authorized board interactions', () => {
  it('labels the last Massive column and hides unknown contents', () => {
    expect(coordinate({ x: 27, y: 27 })).toBe('AB28');
    expect(cellLabel(view.cells[4]!, new Map())).toBe('G1, hidden');
  });
  it('highlights only legal own action targets', () => {
    expect([...targetsFor(view, 'me', 'build')]).toEqual(['1,0', '1,1']);
    expect([...targetsFor(view, 'me', 'upgrade')]).toEqual(['0,0']);
    expect([...targetsFor(view, 'me', 'expand', 't')]).toEqual(['1,0']);
    expect(targetsFor(view, 'me', 'expand', 'missing').size).toBe(0);
  });
  it('permits attacks on both hidden and revealed enemy cells and filters card targets', () => {
    expect([...targetsFor(view, 'me', 'attack')]).toEqual(['6,0', '7,0']);
    expect([...targetsFor(view, 'me', 'hidden_enemy_cell')]).toEqual(['6,0']);
    expect([...targetsFor(view, 'me', 'damaged_own_tower')]).toEqual(['0,0']);
  });
  it('ignores old versions and old-match responses but accepts rematch version zero', () => {
    expect(shouldReplace(view, { ...view, version: 1 }, 'a')).toBe(false);
    expect(shouldReplace(view, { ...view, version: 2 }, 'a')).toBe(true);
    expect(
      shouldReplace(view, { ...view, matchId: 'b', version: 0 }, 'b'),
    ).toBe(true);
    expect(shouldReplace({ ...view, matchId: 'b' }, view, 'b')).toBe(false);
  });
  it('uses server offset and never shows a negative timer', () => {
    expect(secondsLeft(10000, 500, 8000)).toBe(2);
    expect(secondsLeft(10000, 500, 11000)).toBe(0);
  });
  it('only renders an attack result when projected details include it', () => {
    const room = { players: [{ id: 'me', displayName: 'Ada' }] } as RoomView;
    const entry = { sequence: 1, playerId: 'me', type: 'attack' as const };
    expect(eventText(entry, room, new Map())).toBe('Ada attacked');
    expect(
      eventText({ ...entry, details: { outcome: 'hit' } }, room, new Map()),
    ).toBe('Ada attacked · Hit');
    expect(
      eventText(
        { ...entry, details: { outcome: { invalid: true } } },
        room,
        new Map(),
      ),
    ).toBe('Ada attacked');
  });
});
