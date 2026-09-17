import {
  adjacent,
  allCells,
  cellKey,
  occupiedCell,
  ownsCell,
  quadrantAt,
  quadrantCells,
  towerAt,
} from '../board.js';
import type {
  AbilityCardDefinition,
  Cell,
  MatchState,
  TargetDefinition,
  TargetValue,
} from '../types.js';

export const isCell = (v: unknown): v is Cell =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  'x' in v &&
  'y' in v &&
  Number.isInteger(v.x) &&
  Number.isInteger(v.y);
export function rectangle(anchor: Cell, size: number): Cell[] {
  return Array.from({ length: size * size }, (_, i) => ({
    x: anchor.x + (i % size),
    y: anchor.y + Math.floor(i / size),
  }));
}
export function neighbors(state: MatchState, cell: Cell): Cell[] {
  return allCells(state.preset).filter(
    (c) =>
      adjacent(c, cell) &&
      quadrantAt(state.preset, c) === quadrantAt(state.preset, cell),
  );
}
export function targetCandidates(
  state: MatchState,
  playerId: string,
  target: TargetDefinition,
  selected: Record<string, TargetValue> = {},
): (Cell | string)[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.eliminated) return [];
  const own = state.towers
    .filter((t) => t.ownerId === playerId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const empty = allCells(state.preset).filter(
    (c) => ownsCell(state, player, c) && !towerAt(state, c),
  );
  const enemy = allCells(state.preset).filter(
    (c) => !ownsCell(state, player, c) && occupiedCell(state, c),
  );
  switch (target.kind) {
    case 'own_tower':
      return own.map((t) => t.id);
    case 'damaged_own_tower':
    case 'own_towers':
      return own.filter((t) => t.health < 10).map((t) => t.id);
    case 'one_health_tower':
      return own.filter((t) => t.health === 1).map((t) => t.id);
    case 'expandable_tower':
      return own
        .filter((t) => empty.some((c) => t.cells.some((x) => adjacent(x, c))))
        .map((t) => t.id);
    case 'revealed_enemy_tower':
      return state.towers
        .filter(
          (t) =>
            t.ownerId !== playerId &&
            t.cells.some((c) => player.revealed.includes(cellKey(c))),
        )
        .map((t) => t.id)
        .sort();
    case 'empty_own_cells':
      return empty;
    case 'expansion_cells': {
      const tower = own.find(
        (t) => t.id === selected[target.towerTarget ?? 'tower'],
      );
      const chosen = selected[target.id];
      const cells = Array.isArray(chosen) ? chosen.filter(isCell) : [];
      return tower
        ? empty.filter(
            (c) =>
              !cells.some((x) => cellKey(x) === cellKey(c)) &&
              [...tower.cells, ...cells].some((x) => adjacent(x, c)),
          )
        : [];
    }
    case 'enemy_cell':
    case 'connected_enemy_cells':
    case 'enemy_row_column':
      return enemy;
    case 'hidden_enemy_cell':
      return enemy.filter((c) => !player.revealed.includes(cellKey(c)));
    case 'enemy_rectangle':
      return enemy.filter((c) =>
        rectangle(c, target.size!).every(
          (x) => quadrantAt(state.preset, x) === quadrantAt(state.preset, c),
        ),
      );
    case 'enemy_quadrant':
      return state.players
        .filter(
          (p) =>
            p.id !== playerId &&
            !p.eliminated &&
            quadrantCells(state.preset, p.quadrant).some(
              (c) => !player.revealed.includes(cellKey(c)),
            ),
        )
        .map((p) => p.id)
        .sort();
  }
}
export function isMultiTarget(target: TargetDefinition) {
  return [
    'own_towers',
    'empty_own_cells',
    'expansion_cells',
    'connected_enemy_cells',
  ].includes(target.kind);
}
export function validateTargets(
  state: MatchState,
  playerId: string,
  card: AbilityCardDefinition,
  targets: Record<string, TargetValue>,
): boolean {
  if (Object.keys(targets).length !== card.targets.length) return false;
  const previous: Record<string, TargetValue> = {};
  for (const target of card.targets) {
    const value = targets[target.id];
    if (isMultiTarget(target)) {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > target.count! ||
        new Set(
          value.map((v) =>
            typeof v === 'string' ? v : isCell(v) ? cellKey(v) : 'invalid',
          ),
        ).size !== value.length
      )
        return false;
      if (
        target.kind === 'own_towers' &&
        value.length !==
          Math.min(
            target.count!,
            targetCandidates(state, playerId, target).length,
          )
      )
        return false;
      if (
        ['empty_own_cells', 'connected_enemy_cells'].includes(target.kind) &&
        value.length !== target.count
      )
        return false;
      const accumulated: (Cell | string)[] = [];
      for (const item of value) {
        previous[target.id] = accumulated as TargetValue;
        if (
          !targetCandidates(state, playerId, target, previous).some((v) =>
            typeof v === 'string'
              ? v === item
              : isCell(item) && cellKey(v) === cellKey(item),
          )
        )
          return false;
        accumulated.push(item);
      }
      if (target.kind === 'connected_enemy_cells') {
        const cells = value.filter(isCell),
          visited = [cells[0]!];
        for (let i = 0; i < visited.length; i++)
          for (const c of cells)
            if (!visited.includes(c) && adjacent(visited[i]!, c))
              visited.push(c);
        if (visited.length !== cells.length) return false;
      }
    } else if (
      !targetCandidates(state, playerId, target, previous).some((v) =>
        typeof v === 'string'
          ? v === value
          : isCell(value) && cellKey(v) === cellKey(value),
      )
    )
      return false;
    previous[target.id] = value!;
  }
  return true;
}
export function fallbackTargets(
  state: MatchState,
  playerId: string,
  card: AbilityCardDefinition,
): Record<string, TargetValue> {
  const selected: Record<string, TargetValue> = {};
  for (const target of card.targets) {
    if (!isMultiTarget(target)) {
      selected[target.id] = targetCandidates(
        state,
        playerId,
        target,
        selected,
      )[0]!;
      continue;
    }
    const chosen: (Cell | string)[] = [];
    selected[target.id] = chosen as TargetValue;
    for (let i = 0; i < target.count!; i++) {
      const candidate = targetCandidates(
        state,
        playerId,
        target,
        selected,
      ).find(
        (c) =>
          !chosen.some((x) =>
            typeof c === 'string'
              ? x === c
              : isCell(x) && cellKey(x) === cellKey(c),
          ) &&
          (target.kind !== 'connected_enemy_cells' ||
            !chosen.length ||
            chosen.some((x) => isCell(x) && isCell(c) && adjacent(x, c))),
      );
      if (candidate === undefined) break;
      chosen.push(candidate);
    }
  }
  return selected;
}
