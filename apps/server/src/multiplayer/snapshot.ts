import { z } from 'zod';
import {
  cellSchema,
  idSchema,
  presetSchema,
  resultSchema,
  historySchema,
} from '@quadrant/protocol';
import {
  PRESETS,
  inBounds,
  quadrantAt,
  adjacent,
  type MatchState,
  type EngineRegistry,
} from '@quadrant/game-engine';

const n = z.number().int().nonnegative();
const snapshotSchema = z.strictObject({
  id: z.uuid(),
  preset: presetSchema,
  cardCatalogVersion: idSchema,
  balanceVersion: idSchema,
  seed: n.max(0xffffffff),
  rngState: n.max(0xffffffff),
  nextId: n,
  version: n,
  lastCommandAt: n,
  players: z
    .array(
      z.strictObject({
        id: z.uuid(),
        quadrant: z.enum(['nw', 'ne', 'sw', 'se']),
        eliminated: z.boolean(),
        timedOutTurns: n,
        turnsStarted: n,
        revealed: z.array(z.string()),
        cardsSelected: z.record(z.string(), n),
      }),
    )
    .min(2)
    .max(4),
  turnOrder: z.array(z.uuid()).min(2).max(4),
  towers: z.array(
    z.strictObject({
      id: idSchema,
      ownerId: z.uuid(),
      type: z.enum(['normal', 'town_hall']),
      cells: z.array(cellSchema).min(1),
      health: n.min(1).max(10),
    }),
  ),
  effects: z.array(
    z.strictObject({
      id: idSchema,
      cardId: idSchema,
      cardVersion: n,
      ownerId: z.uuid(),
      targets: z.record(z.string(), z.union([cellSchema, idSchema])),
      revealed: z.boolean(),
      remainingCharges: n.nullable(),
      expiresTurn: n.nullable(),
      expiresOwnerTurn: n.nullable(),
      expiresRound: n.nullable(),
    }),
  ),
  turn: z.strictObject({
    playerId: z.uuid(),
    number: n,
    round: n.min(1),
    actionsRemaining: n.max(2),
    cardOffer: z.array(idSchema).length(3),
    selectedCardId: idSchema.nullable(),
    deadline: n,
  }),
  history: historySchema.transform((entries) =>
    entries.map((e) => ({ ...e, details: e.details ?? {} })),
  ),
  result: resultSchema.nullable(),
}) satisfies z.ZodType<MatchState>;

export function parseSnapshot(
  raw: unknown,
  schemaVersion: number,
  registry: EngineRegistry,
): MatchState {
  if (schemaVersion !== 1) throw new Error('Unsupported snapshot schema');
  const state = snapshotSchema.parse(raw);
  const catalog = registry.catalogs[state.cardCatalogVersion];
  if (!catalog || !registry.balances[state.balanceVersion])
    throw new Error('Unavailable pinned content');
  const ids = new Set(state.players.map((p) => p.id));
  const cards = new Map(catalog.cards.map((c) => [c.id, c]));
  const occupied = new Set<string>();
  if (
    ids.size !== state.players.length ||
    new Set(state.players.map((p) => p.quadrant)).size !==
      state.players.length ||
    new Set(state.turnOrder).size !== state.players.length ||
    state.turnOrder.some((id) => !ids.has(id)) ||
    !ids.has(state.turn.playerId) ||
    state.turn.round > PRESETS[state.preset].rounds ||
    new Set(state.turn.cardOffer).size !== 3 ||
    state.turn.cardOffer.some((id) => !cards.has(id)) ||
    (state.turn.selectedCardId !== null &&
      !state.turn.cardOffer.includes(state.turn.selectedCardId)) ||
    (!state.result && state.turn.deadline < state.lastCommandAt) ||
    (!state.result &&
      state.players.find((p) => p.id === state.turn.playerId)!.eliminated) ||
    new Set(state.towers.map((t) => t.id)).size !== state.towers.length
  )
    throw new Error('Invalid snapshot invariants');
  for (const tower of state.towers) {
    const owner = state.players.find((p) => p.id === tower.ownerId);
    if (!owner || owner.eliminated) throw new Error('Invalid tower owner');
    for (const cell of tower.cells) {
      const key = `${cell.x},${cell.y}`;
      if (
        !inBounds(state.preset, cell) ||
        quadrantAt(state.preset, cell) !== owner.quadrant ||
        occupied.has(key)
      )
        throw new Error('Invalid tower cells');
      occupied.add(key);
    }
    const reachable = [tower.cells[0]!];
    for (let i = 0; i < reachable.length; i++)
      for (const cell of tower.cells) {
        if (!reachable.includes(cell) && adjacent(reachable[i]!, cell))
          reachable.push(cell);
      }
    if (reachable.length !== tower.cells.length)
      throw new Error('Disconnected tower');
  }
  for (const player of state.players) {
    if (
      player.eliminated !== !state.towers.some((t) => t.ownerId === player.id)
    )
      throw new Error('Invalid elimination');
    for (const key of player.revealed) {
      if (!/^\d+,\d+$/.test(key)) throw new Error('Invalid revealed cell');
      const [x, y] = key.split(',').map(Number);
      if (!inBounds(state.preset, { x: x!, y: y! }))
        throw new Error('Invalid revealed cell');
    }
  }
  if (new Set(state.effects.map((e) => e.id)).size !== state.effects.length)
    throw new Error('Duplicate effect');
  for (const effect of state.effects) {
    const card = cards.get(effect.cardId);
    if (
      !card ||
      card.version !== effect.cardVersion ||
      !ids.has(effect.ownerId)
    )
      throw new Error('Invalid effect content');
    for (const target of card.targets) {
      const value = effect.targets[target.id];
      if (target.kind === 'own_tower' || target.kind === 'damaged_own_tower') {
        if (
          typeof value !== 'string' ||
          !state.towers.some(
            (t) => t.id === value && t.ownerId === effect.ownerId,
          )
        )
          throw new Error('Invalid effect target');
      } else if (
        !value ||
        typeof value === 'string' ||
        !inBounds(state.preset, value)
      )
        throw new Error('Invalid effect target');
    }
  }
  return state;
}
