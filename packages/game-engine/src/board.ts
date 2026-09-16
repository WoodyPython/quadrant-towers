import type { Cell, MatchState, Player, PresetId, Quadrant } from './types.js';

export const PRESETS = {
  small: { quadrantSize: 6, boardSize: 12, rounds: 10 },
  medium: { quadrantSize: 8, boardSize: 16, rounds: 12 },
  large: { quadrantSize: 10, boardSize: 20, rounds: 16 },
  massive: { quadrantSize: 14, boardSize: 28, rounds: 22 },
} as const;
export const QUADRANTS: readonly Quadrant[] = ['nw', 'ne', 'sw', 'se'];
export const cellKey = (cell: Cell): string => `${cell.x},${cell.y}`;
export const sameCell = (a: Cell, b: Cell): boolean =>
  a.x === b.x && a.y === b.y;
export function inBounds(preset: PresetId, cell: Cell): boolean {
  const size = PRESETS[preset].boardSize;
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < size &&
    cell.y < size
  );
}
export function quadrantAt(preset: PresetId, cell: Cell): Quadrant | null {
  if (!inBounds(preset, cell)) return null;
  const size = PRESETS[preset].quadrantSize;
  return cell.y < size
    ? cell.x < size
      ? 'nw'
      : 'ne'
    : cell.x < size
      ? 'sw'
      : 'se';
}
export function quadrantCells(preset: PresetId, quadrant: Quadrant): Cell[] {
  const size = PRESETS[preset].quadrantSize;
  const left = quadrant.endsWith('e') ? size : 0;
  const top = quadrant.startsWith('s') ? size : 0;
  return Array.from({ length: size * size }, (_, i) => ({
    x: left + (i % size),
    y: top + Math.floor(i / size),
  }));
}
export function allCells(preset: PresetId): Cell[] {
  const size = PRESETS[preset].boardSize;
  return Array.from({ length: size * size }, (_, i) => ({
    x: i % size,
    y: Math.floor(i / size),
  }));
}
export const adjacent = (a: Cell, b: Cell): boolean =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
export const towerAt = (state: MatchState, cell: Cell) =>
  state.towers.find((tower) => tower.cells.some((c) => sameCell(c, cell)));
export const ownsCell = (
  state: MatchState,
  player: Player,
  cell: Cell,
): boolean => quadrantAt(state.preset, cell) === player.quadrant;
export const occupiedCell = (state: MatchState, cell: Cell): boolean => {
  const quadrant = quadrantAt(state.preset, cell);
  return state.players.some((player) => player.quadrant === quadrant);
};
export function coordinateLabel(cell: Cell): string {
  let column = cell.x + 1;
  let label = '';
  while (column > 0) {
    column--;
    label = String.fromCharCode(65 + (column % 26)) + label;
    column = Math.floor(column / 26);
  }
  return `${label}${cell.y + 1}`;
}
