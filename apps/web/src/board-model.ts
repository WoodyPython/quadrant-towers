import type { MatchView, RoomView, Requests } from '@quadrant/protocol';

export type Cell = MatchView['cells'][number];
export type Point = Cell['cell'];
export type Action = Requests['action:submit']['action']['type'];
export const presets = {
  small: {
    name: 'Small',
    quadrant: 6,
    board: 12,
    rounds: 10,
    duration: '20–30 min',
  },
  medium: {
    name: 'Medium',
    quadrant: 8,
    board: 16,
    rounds: 12,
    duration: '25–40 min',
  },
  large: {
    name: 'Large',
    quadrant: 10,
    board: 20,
    rounds: 16,
    duration: '35–55 min',
  },
  massive: {
    name: 'Massive',
    quadrant: 14,
    board: 28,
    rounds: 22,
    duration: '50–75 min',
  },
} as const;
export const marks = ['circle', 'diamond', 'square', 'triangle'] as const;
export const key = (p: Point) => `${p.x},${p.y}`;
export function cardTitle(name: string) {
  const clean = name.replace(/ \(prototype\)$/, '').replaceAll('-', ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
export function cardDescription(text: string) {
  const triggers: Record<string, string> = {
    on_selected: '',
    before_attack: 'When attacked: ',
    after_damage: 'After taking damage: ',
    on_build: 'When you build: ',
    on_turn_start: 'At the start of your turn: ',
  };
  return text.replace(
    /\b(on_selected|before_attack|after_damage|on_build|on_turn_start):\s*/g,
    (_, trigger: string) => triggers[trigger] ?? '',
  );
}
export function coordinate(p: Point): string {
  let x = p.x + 1;
  let letters = '';
  while (x > 0) {
    x--;
    letters = String.fromCharCode(65 + (x % 26)) + letters;
    x = Math.floor(x / 26);
  }
  return `${letters}${p.y + 1}`;
}
export function quadrant(p: Point, size: number) {
  return `${p.y < size ? 'n' : 's'}${p.x < size ? 'w' : 'e'}`;
}
export function isOwn(view: MatchView, playerId: string, p: Point) {
  return (
    view.players.find((p) => p.id === playerId)?.quadrant ===
    quadrant(p, view.dimensions.quadrantSize)
  );
}
export function isAvailable(view: MatchView, p: Point) {
  const region = quadrant(p, view.dimensions.quadrantSize);
  return view.players.some((player) => player.quadrant === region);
}
export function targetsFor(
  view: MatchView,
  playerId: string,
  mode: Action | string,
  towerId?: string,
): Set<string> {
  const footprint = view.cells.filter(
    (c) =>
      c.visibility === 'visible' &&
      c.tower?.id === towerId &&
      c.tower?.ownerId === playerId,
  );
  return new Set(
    view.cells
      .filter((c) => {
        if (!isAvailable(view, c.cell)) return false;
        const own = isOwn(view, playerId, c.cell);
        const tower = c.visibility === 'visible' ? c.tower : null;
        switch (mode) {
          case 'attack':
          case 'enemy_cell':
            return !own;
          case 'hidden_enemy_cell':
            return !own && c.visibility === 'hidden';
          case 'own_tower':
            return own && !!tower;
          case 'upgrade':
          case 'damaged_own_tower':
            return own && !!tower && tower.health < 10;
          case 'build':
          case 'place_town_hall':
            return own && c.visibility === 'visible' && !tower;
          case 'expand':
            return (
              own &&
              c.visibility === 'visible' &&
              !tower &&
              footprint.some(
                (t) =>
                  Math.abs(t.cell.x - c.cell.x) +
                    Math.abs(t.cell.y - c.cell.y) ===
                  1,
              )
            );
          default:
            return false;
        }
      })
      .map((c) => key(c.cell)),
  );
}
export function cellLabel(c: Cell, names: Map<string, string>) {
  if (c.visibility === 'hidden') return `${coordinate(c.cell)}, hidden`;
  if (!c.tower) return `${coordinate(c.cell)}, empty`;
  return `${coordinate(c.cell)}, ${names.get(c.tower.ownerId) ?? 'Player'}, ${c.tower.type === 'town_hall' ? 'Town Hall' : 'tower'}, ${c.tower.health} health`;
}
export function shouldReplace(
  current: MatchView | null,
  next: MatchView,
  roomMatchId: string | null | undefined,
) {
  return (
    next.matchId === roomMatchId &&
    (!current ||
      current.matchId !== next.matchId ||
      next.version >= current.version)
  );
}
export function secondsLeft(deadline: number, offset: number, now: number) {
  return Math.max(0, Math.ceil((deadline - now - offset) / 1000));
}
export function eventText(
  entry: MatchView['history'][number],
  room: RoomView,
  cards: Map<string, string>,
) {
  const name =
    room.players.find((p) => p.id === entry.playerId)?.displayName ?? 'Player';
  const details = entry.details;
  const actionNames: Record<string, string> = {
    town_hall_placed: 'placed their Town Hall',
    build: 'built a tower',
    upgrade: 'upgraded a tower',
    expand: 'expanded a tower',
    attack: 'attacked',
    card_selected: 'chose a card',
    damage_resolved: 'dealt damage',
    effect_triggered: 'triggered an effect',
    effect_expired: 'had an effect expire',
    eliminated: 'was eliminated',
    timeout: 'ran out of time',
    turn_started: 'started their turn',
    turn_ended: 'ended their turn',
    setup: 'joined the match',
    match_ended: 'finished the match',
    card_offer: 'received three cards',
  };
  let text = `${name} ${actionNames[entry.type] ?? 'played'}`;
  if (
    entry.type === 'damage_resolved' &&
    typeof details?.damage === 'number' &&
    Number.isInteger(details.damage) &&
    details.damage >= 0
  ) {
    text =
      details.damage === 0
        ? `${name} · Damage prevented`
        : `${name} dealt ${details.damage} damage${details.destroyed ? ' · Tower destroyed' : ''}`;
  }
  if (entry.type === 'card_selected' && typeof details?.cardId === 'string')
    text = `${name} chose ${cards.get(details.cardId) ?? 'a card'}`;
  if (
    ['effect_triggered', 'effect_expired'].includes(entry.type) &&
    typeof details?.cardId === 'string'
  )
    text = `${name} · ${cards.get(details.cardId) ?? 'Card effect'} ${entry.type === 'effect_expired' ? 'expired' : 'triggered'}`;
  if (entry.type === 'card_offer' && Array.isArray(details?.cardIds)) {
    const ids = details.cardIds.filter(
      (id): id is string => typeof id === 'string',
    );
    if (ids.length === 3)
      text = `${name} was offered ${ids.map((id) => cards.get(id) ?? 'a card').join(', ')}`;
  }
  const cell = details?.cell;
  if (
    cell &&
    typeof cell === 'object' &&
    'x' in cell &&
    'y' in cell &&
    typeof cell.x === 'number' &&
    typeof cell.y === 'number' &&
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.x < 28 &&
    cell.y >= 0 &&
    cell.y < 28
  )
    text += ` at ${coordinate({ x: cell.x, y: cell.y })}`;
  if (entry.type === 'attack' && typeof details?.outcome === 'string') {
    const outcomes: Record<string, string> = {
      hit: 'Hit',
      miss: 'Miss',
      prevented: 'Damage prevented',
      destroyed: 'Tower destroyed',
    };
    if (outcomes[details.outcome]) text += ` · ${outcomes[details.outcome]}`;
  }
  if (
    typeof details?.health === 'number' &&
    Number.isInteger(details.health) &&
    details.health >= 0 &&
    details.health <= 10
  )
    text += ` · ${details.health} health`;
  if (entry.type === 'turn_started' && typeof details?.round === 'number')
    text += ` · round ${details.round}`;
  return text;
}

export type CardTarget =
  import('@quadrant/protocol').Requests['card:choose']['targets'][string];
export type TargetDefinition = NonNullable<
  Extract<import('@quadrant/protocol').Ack, { ok: true }>['content']
>['cards'][number]['targets'][number];
const point = (v: unknown): v is Point =>
  !!v && typeof v === 'object' && !Array.isArray(v) && 'x' in v && 'y' in v;
const touching = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
export const multiTarget = (target: TargetDefinition) =>
  [
    'own_towers',
    'empty_own_cells',
    'expansion_cells',
    'connected_enemy_cells',
  ].includes(target.kind);
export function cardTargetsFor(
  view: MatchView,
  playerId: string,
  target: TargetDefinition,
  selected: Record<string, CardTarget>,
): Set<string> {
  const value = selected[target.id];
  const picked = Array.isArray(value) ? value : [];
  const pickedPoints = picked.filter(point);
  const towerId = selected[target.towerTarget ?? 'tower'];
  const footprint = view.cells
    .filter((c) => c.visibility === 'visible' && c.tower?.id === towerId)
    .map((c) => c.cell);
  const empty = targetsFor(view, playerId, 'build');
  const basic = targetsFor(view, playerId, target.kind);
  return new Set(
    view.cells
      .filter((c) => {
        const own = isOwn(view, playerId, c.cell),
          tower = c.visibility === 'visible' ? c.tower : null;
        if (!isAvailable(view, c.cell)) return false;
        if (
          picked.some((x) =>
            typeof x === 'string'
              ? x === tower?.id
              : point(x) && key(x) === key(c.cell),
          )
        )
          return false;
        switch (target.kind) {
          case 'own_tower':
          case 'damaged_own_tower':
          case 'enemy_cell':
          case 'hidden_enemy_cell':
            return basic.has(key(c.cell));
          case 'one_health_tower':
            return own && tower?.health === 1;
          case 'expandable_tower':
            return (
              own &&
              !!tower &&
              view.cells.some(
                (x) =>
                  empty.has(key(x.cell)) &&
                  view.cells.some(
                    (f) =>
                      f.visibility === 'visible' &&
                      f.tower?.id === tower.id &&
                      touching(f.cell, x.cell),
                  ),
              )
            );
          case 'revealed_enemy_tower':
            return !own && !!tower;
          case 'own_towers':
            return own && !!tower && tower.health < 10;
          case 'empty_own_cells':
            return empty.has(key(c.cell));
          case 'expansion_cells':
            return (
              empty.has(key(c.cell)) &&
              [...footprint, ...pickedPoints].some((x) => touching(x, c.cell))
            );
          case 'connected_enemy_cells':
            return (
              !own &&
              (!pickedPoints.length ||
                pickedPoints.some((x) => touching(x, c.cell)))
            );
          case 'enemy_row_column':
            return !own;
          case 'enemy_rectangle': {
            const size = target.size!,
              q = quadrant(c.cell, view.dimensions.quadrantSize);
            return (
              !own &&
              quadrant(
                { x: c.cell.x + size - 1, y: c.cell.y + size - 1 },
                view.dimensions.quadrantSize,
              ) === q &&
              c.cell.x + size <= view.dimensions.boardSize &&
              c.cell.y + size <= view.dimensions.boardSize
            );
          }
          case 'enemy_quadrant': {
            const enemy = view.players.find(
              (p) =>
                p.quadrant === quadrant(c.cell, view.dimensions.quadrantSize),
            );
            return (
              !own &&
              !!enemy &&
              !enemy.eliminated &&
              view.cells.some(
                (x) =>
                  quadrant(x.cell, view.dimensions.quadrantSize) ===
                    enemy.quadrant && x.visibility === 'hidden',
              )
            );
          }
        }
      })
      .map((c) => key(c.cell)),
  );
}
export function targetComplete(
  view: MatchView,
  playerId: string,
  target: TargetDefinition,
  selected: Record<string, CardTarget>,
): boolean {
  const value = selected[target.id];
  if (!multiTarget(target)) return value !== undefined;
  if (!Array.isArray(value) || !value.length) return false;
  if (value.length === target.count) return true;
  if (target.kind === 'own_towers' || target.kind === 'expansion_cells')
    return cardTargetsFor(view, playerId, target, selected).size === 0;
  return false;
}
export function cardPreview(
  view: MatchView,
  targets: TargetDefinition[],
  selected: Record<string, CardTarget>,
): Set<string> {
  const preview = new Set<string>();
  for (const target of targets) {
    const value = selected[target.id];
    if (Array.isArray(value))
      for (const v of value) {
        if (point(v)) preview.add(key(v));
        else
          for (const c of view.cells)
            if (c.visibility === 'visible' && c.tower?.id === v)
              preview.add(key(c.cell));
      }
    else if (point(value)) {
      for (const c of view.cells) {
        const same =
          quadrant(c.cell, view.dimensions.quadrantSize) ===
          quadrant(value, view.dimensions.quadrantSize);
        if (
          target.kind === 'enemy_rectangle' &&
          c.cell.x >= value.x &&
          c.cell.x < value.x + target.size! &&
          c.cell.y >= value.y &&
          c.cell.y < value.y + target.size!
        )
          preview.add(key(c.cell));
        else if (
          target.kind === 'enemy_row_column' &&
          same &&
          (c.cell.x === value.x || c.cell.y === value.y)
        )
          preview.add(key(c.cell));
      }
      preview.add(key(value));
    } else if (typeof value === 'string')
      for (const c of view.cells)
        if (
          (c.visibility === 'visible' && c.tower?.id === value) ||
          (target.kind === 'enemy_quadrant' &&
            quadrant(c.cell, view.dimensions.quadrantSize) ===
              view.players.find((p) => p.id === value)?.quadrant)
        )
          preview.add(key(c.cell));
  }
  return preview;
}
