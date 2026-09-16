import { z } from 'zod';

export const presetSchema = z.enum(['small', 'medium', 'large', 'massive']);
export const idSchema = z.string().min(1).max(128);
const integer = z.number().int().nonnegative();
export const cellSchema = z.strictObject({
  x: integer.max(27),
  y: integer.max(27),
});
const nameSchema = z
  .string()
  .transform((s) => s.normalize('NFKC').trim())
  .refine(
    (s) =>
      [...s].length >= 1 && [...s].length <= 24 && !/[\p{Cc}\p{Cf}]/u.test(s),
  );
const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{6}$/);
export const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('build'), cell: cellSchema }),
  z.strictObject({ type: z.literal('upgrade'), towerId: idSchema }),
  z.strictObject({
    type: z.literal('expand'),
    towerId: idSchema,
    cell: cellSchema,
  }),
  z.strictObject({ type: z.literal('attack'), cell: cellSchema }),
]);
const mutation = {
  commandId: z.uuid(),
  matchId: z.uuid(),
  expectedVersion: integer,
};
export const requestSchemas = {
  'room:create': z.strictObject({
    displayName: nameSchema,
    preset: presetSchema,
  }),
  'room:join': z.strictObject({ code: codeSchema, displayName: nameSchema }),
  'room:rejoin': z.strictObject({
    code: codeSchema,
    token: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  'room:leave': z.strictObject({}),
  'room:remove': z.strictObject({ playerId: z.uuid() }),
  'match:start': z.strictObject({ commandId: z.uuid() }),
  'card:choose': z.strictObject({
    ...mutation,
    cardId: idSchema,
    targets: z
      .record(idSchema, z.union([cellSchema, idSchema]))
      .refine((v) => Object.keys(v).length <= 16),
  }),
  'action:submit': z.strictObject({ ...mutation, action: actionSchema }),
  'turn:end': z.strictObject(mutation),
  'turn:sync': z.strictObject({}),
  'rematch:vote': z.strictObject({ commandId: z.uuid(), matchId: z.uuid() }),
} as const;
export type RequestEvent = keyof typeof requestSchemas;
export type Requests = {
  [K in RequestEvent]: z.infer<(typeof requestSchemas)[K]>;
};

export const roomViewSchema = z.strictObject({
  id: z.uuid(),
  code: codeSchema,
  preset: presetSchema,
  status: z.enum(['lobby', 'active', 'finished', 'closed']),
  hostPlayerId: z.uuid().nullable(),
  matchId: z.uuid().nullable(),
  players: z
    .array(
      z.strictObject({
        id: z.uuid(),
        displayName: z.string(),
        seat: integer.max(3),
        connected: z.boolean(),
        removableAt: integer.nullable(),
        rematchVote: z.boolean(),
      }),
    )
    .max(4),
});
const scoreSchema = z.strictObject({
  playerId: idSchema,
  points: integer,
  health: integer,
  townHall: z.boolean(),
  timedOutTurns: integer,
  turnOrderIndex: integer,
  towers: z.array(
    z.strictObject({ towerId: idSchema, size: integer, points: integer }),
  ),
});
export const resultSchema = z.strictObject({
  winnerId: idSchema,
  reason: z.enum(['last_survivor', 'round_limit']),
  scores: z.array(scoreSchema),
  tieBreakers: z.array(
    z.strictObject({
      criterion: z.enum(['health', 'town_hall', 'timeouts', 'turn_order']),
      remainingPlayerIds: z.array(idSchema),
    }),
  ),
});
export const effectViewSchema = z.strictObject({
  id: idSchema,
  cardId: idSchema,
  cardVersion: integer,
  ownerId: idSchema,
  targets: z.record(z.string(), z.union([cellSchema, idSchema])).optional(),
  remainingCharges: integer.nullable().optional(),
  expiresTurn: integer.nullable().optional(),
  expiresOwnerTurn: integer.nullable().optional(),
  expiresRound: integer.nullable().optional(),
});
export const historySchema = z.array(
  z.strictObject({
    sequence: integer,
    playerId: idSchema,
    type: z.enum([
      'setup',
      'card_offer',
      'card_selected',
      'effect_triggered',
      'effect_expired',
      'turn_started',
      'turn_ended',
      'timeout',
      'eliminated',
      'match_ended',
      'build',
      'upgrade',
      'expand',
      'attack',
    ]),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
);
export const matchViewSchema = z.strictObject({
  matchId: z.uuid(),
  version: integer,
  preset: presetSchema,
  dimensions: z.strictObject({
    quadrantSize: integer,
    boardSize: integer,
    rounds: integer,
  }),
  cardCatalogVersion: idSchema,
  balanceVersion: idSchema,
  players: z.array(
    z.strictObject({
      id: idSchema,
      quadrant: z.enum(['nw', 'ne', 'sw', 'se']),
      eliminated: z.boolean(),
    }),
  ),
  turnOrder: z.array(idSchema),
  turn: z.strictObject({
    playerId: idSchema,
    number: integer,
    round: integer,
    deadline: integer,
    actionsRemaining: integer.max(2),
    cardOffer: z.array(idSchema).length(3).optional(),
    selectedCardId: idSchema.nullable().optional(),
  }),
  cells: z.array(
    z.discriminatedUnion('visibility', [
      z.strictObject({ cell: cellSchema, visibility: z.literal('hidden') }),
      z.strictObject({
        cell: cellSchema,
        visibility: z.literal('visible'),
        tower: z
          .strictObject({
            id: idSchema,
            ownerId: idSchema,
            type: z.enum(['normal', 'town_hall']),
            health: integer.min(1).max(10),
          })
          .nullable(),
      }),
    ]),
  ),
  effects: z.array(effectViewSchema),
  history: historySchema,
  result: resultSchema.nullable(),
});
export const contentSchema = z.strictObject({
  cardCatalogVersion: idSchema,
  balanceVersion: idSchema,
  cards: z.array(
    z.strictObject({
      id: idSchema,
      version: integer,
      name: z.string(),
      description: z.string(),
      rarityId: idSchema,
      lifecycle: z.enum(['consumable', 'passive']),
      artKey: z.string(),
      targets: z.array(
        z.strictObject({
          id: idSchema,
          kind: z.enum([
            'own_tower',
            'damaged_own_tower',
            'enemy_cell',
            'hidden_enemy_cell',
          ]),
          timing: z.literal('on_selected'),
        }),
      ),
    }),
  ),
  rarities: z.array(
    z.strictObject({
      id: idSchema,
      rank: integer,
      label: z.string(),
      icon: z.string(),
      color: z.string(),
    }),
  ),
});
export const errorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'UNAUTHORIZED',
  'ALREADY_SEATED',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_CLOSED',
  'HOST_REQUIRED',
  'PLAYERS_NOT_READY',
  'SEAT_NOT_REMOVABLE',
  'MATCH_NOT_FOUND',
  'MATCH_FINISHED',
  'STALE_VERSION',
  'COMMAND_ID_REUSED',
  'NOT_YOUR_TURN',
  'DEADLINE_ELAPSED',
  'ILLEGAL_COMMAND',
  'MATCH_NOT_FINISHED',
  'SERVICE_UNAVAILABLE',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const ackSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    commandId: z.uuid().optional(),
    matchId: z.uuid().optional(),
    version: integer.optional(),
    identity: z
      .strictObject({ playerId: z.uuid(), token: z.string(), code: codeSchema })
      .optional(),
    room: roomViewSchema.optional(),
    match: matchViewSchema.optional(),
    content: contentSchema.optional(),
    serverTime: integer.optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: errorCodeSchema,
    message: z.string(),
  }),
]);
export type Ack = z.infer<typeof ackSchema>;
export type RoomView = z.infer<typeof roomViewSchema>;
export type MatchView = z.infer<typeof matchViewSchema>;
export const timerSchema = z.strictObject({
  matchId: z.uuid(),
  version: integer,
  deadline: integer,
  serverTime: integer,
});
export type ClientEvents = {
  [K in RequestEvent]: (
    request: Requests[K],
    acknowledge: (response: Ack) => void,
  ) => void;
};
export interface ServerEvents {
  'room:view': (view: RoomView) => void;
  'match:view': (view: MatchView) => void;
  'match:finished': (view: MatchView) => void;
  'command:accepted': (response: Extract<Ack, { ok: true }>) => void;
  'command:rejected': (response: Extract<Ack, { ok: false }>) => void;
  'server:error': (response: Extract<Ack, { ok: false }>) => void;
  'turn:timer': (timer: z.infer<typeof timerSchema>) => void;
}
