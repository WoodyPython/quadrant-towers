import { expect, it } from 'vitest';
import type { MatchView } from '@quadrant/protocol';
import {
  cardTargetsFor,
  targetComplete,
  cardPreview,
  type TargetDefinition,
} from './board-model';
const view: MatchView = {
  matchId: 'match',
  version: 1,
  phase: 'battle',
  preset: 'small',
  dimensions: { quadrantSize: 6, boardSize: 12, rounds: 10 },
  cardCatalogVersion: 'launch-2',
  balanceVersion: 'launch-2',
  players: [
    { id: 'me', quadrant: 'nw', eliminated: false },
    { id: 'them', quadrant: 'ne', eliminated: false },
  ],
  turnOrder: ['me', 'them'],
  turn: {
    playerId: 'me',
    number: 1,
    round: 1,
    deadline: 90000,
    actionsRemaining: 2,
  },
  effects: [],
  history: [],
  result: null,
  cells: Array.from({ length: 144 }, (_, i) => {
    const cell = { x: i % 12, y: Math.floor(i / 12) };
    return cell.x < 6 && cell.y < 6
      ? {
          cell,
          visibility: 'visible' as const,
          tower:
            cell.x === 0 && cell.y === 0
              ? { id: 'own', ownerId: 'me', type: 'normal' as const, health: 1 }
              : null,
        }
      : { cell, visibility: 'hidden' as const };
  }),
};
const target = (
  kind: TargetDefinition['kind'],
  params: Partial<TargetDefinition> = {},
): TargetDefinition => ({
  id: 'cells',
  kind,
  timing: 'on_selected',
  ...params,
});
it('previews rectangle geometry without reading hidden contents and filters invalid anchors', () => {
  const t = target('enemy_rectangle', { size: 3 });
  const legal = cardTargetsFor(view, 'me', t, {});
  expect(legal.has('6,0')).toBe(true);
  expect(legal.has('10,0')).toBe(false);
  expect(legal.has('6,4')).toBe(false);
  expect(cardPreview(view, [t], { cells: { x: 6, y: 0 } }).size).toBe(9);
  expect(
    view.cells.find((c) => c.cell.x === 6 && c.cell.y === 0)!.visibility,
  ).toBe('hidden');
});
it('advances sequential expansion candidates and allows completion at the maximum', () => {
  const t = target('expansion_cells', { count: 3, towerTarget: 'tower' });
  expect(cardTargetsFor(view, 'me', t, { tower: 'own' })).toEqual(
    new Set(['1,0', '0,1']),
  );
  const selected = {
    tower: 'own',
    cells: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
  };
  expect(cardTargetsFor(view, 'me', t, selected).has('3,0')).toBe(true);
  expect(cardTargetsFor(view, 'me', t, selected).has('1,0')).toBe(false);
  expect(targetComplete(view, 'me', t, selected)).toBe(false);
  expect(
    targetComplete(view, 'me', t, {
      ...selected,
      cells: [...selected.cells, { x: 3, y: 0 }],
    }),
  ).toBe(true);
  expect(cardPreview(view, [t], selected)).toEqual(new Set(['1,0', '2,0']));
});
it('requires three connected cells, excludes duplicates, and keeps the selected count', () => {
  const t = target('connected_enemy_cells', { count: 3 }),
    selected = {
      cells: [
        { x: 6, y: 0 },
        { x: 7, y: 0 },
      ],
    };
  const legal = cardTargetsFor(view, 'me', t, selected);
  expect(legal.has('8,0')).toBe(true);
  expect(legal.has('7,1')).toBe(true);
  expect(legal.has('9,4')).toBe(false);
  expect(legal.has('6,0')).toBe(false);
  expect(targetComplete(view, 'me', t, selected)).toBe(false);
  expect(
    targetComplete(view, 'me', t, {
      cells: [...selected.cells, { x: 7, y: 1 }],
    }),
  ).toBe(true);
});
it('offers only visible enemy tower identities and filters capped own towers', () => {
  const state = structuredClone(view);
  state.cells[6] = {
    cell: { x: 6, y: 0 },
    visibility: 'visible',
    tower: { id: 'known', ownerId: 'them', type: 'normal', health: 3 },
  };
  expect(
    cardTargetsFor(state, 'me', target('revealed_enemy_tower'), {}),
  ).toEqual(new Set(['6,0']));
  expect(
    cardTargetsFor(view, 'me', target('revealed_enemy_tower'), {}).size,
  ).toBe(0);
  const t = target('own_towers', { count: 3 });
  expect(targetComplete(view, 'me', t, { cells: ['own'] })).toBe(true);
  expect(cardTargetsFor(view, 'me', target('one_health_tower'), {})).toEqual(
    new Set(['0,0']),
  );
});
it('selects Strategic Recon by its crossing cell and only active unrevealed enemy quadrants', () => {
  const t = target('enemy_row_column');
  expect(cardPreview(view, [t], { cells: { x: 7, y: 2 } }).size).toBe(11);
  expect(
    cardTargetsFor(view, 'me', target('enemy_quadrant'), {}).has('6,0'),
  ).toBe(true);
  const state = structuredClone(view);
  state.players[1]!.eliminated = true;
  expect(cardTargetsFor(state, 'me', target('enemy_quadrant'), {}).size).toBe(
    0,
  );
});

it('renders private card damage prevention and destruction accurately', async () => {
  const { eventText } = await import('./board-model');
  const room = {
    id: 'room',
    code: 'ABCDEF',
    preset: 'small' as const,
    status: 'active' as const,
    hostPlayerId: 'me',
    matchId: 'match',
    players: [
      {
        id: 'me',
        displayName: 'Ada',
        seat: 0,
        connected: true,
        removableAt: null,
        rematchVote: false,
      },
    ],
  };
  expect(
    eventText(
      {
        sequence: 1,
        playerId: 'me',
        type: 'damage_resolved',
        details: { damage: 0, health: 3 },
      },
      room,
      new Map(),
    ),
  ).toBe('Ada · Damage prevented · 3 health');
  expect(
    eventText(
      {
        sequence: 2,
        playerId: 'me',
        type: 'damage_resolved',
        details: { damage: 3, health: 0, destroyed: true },
      },
      room,
      new Map(),
    ),
  ).toBe('Ada dealt 3 damage · Tower destroyed · 0 health');
});
