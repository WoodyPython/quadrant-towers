import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  jsonb,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const applicationMetadata = pgTable('application_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  preset: text('preset').notNull(),
  status: text('status').notNull(),
  hostPlayerId: uuid('host_player_id'),
  matchId: uuid('match_id'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id),
    displayName: text('display_name').notNull(),
    seat: integer('seat').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    joinedAt: bigint('joined_at', { mode: 'number' }).notNull(),
    disconnectedAt: bigint('disconnected_at', { mode: 'number' }),
    rematchVote: uuid('rematch_vote'),
  },
  (t) => [uniqueIndex('players_room_seat').on(t.roomId, t.seat)],
);
export const matches = pgTable('matches', {
  id: uuid('id').primaryKey(),
  roomId: uuid('room_id')
    .notNull()
    .references(() => rooms.id),
  status: text('status').notNull(),
  preset: text('preset').notNull(),
  seed: bigint('seed', { mode: 'number' }).notNull(),
  version: integer('version').notNull(),
  cardCatalogVersion: text('card_catalog_version').notNull(),
  balanceVersion: text('balance_version').notNull(),
  deadline: bigint('deadline', { mode: 'number' }).notNull(),
  result: jsonb('result'),
});
export const matchSnapshots = pgTable('match_snapshots', {
  matchId: uuid('match_id')
    .primaryKey()
    .references(() => matches.id),
  version: integer('version').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  state: jsonb('state').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});
export const matchCommands = pgTable(
  'match_commands',
  {
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id),
    version: integer('version').notNull(),
    actorId: uuid('actor_id'),
    commandId: text('command_id').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.matchId, t.version] }),
    uniqueIndex('match_command_id').on(t.matchId, t.commandId),
  ],
);
export const commandReceipts = pgTable(
  'command_receipts',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id),
    actorId: uuid('actor_id').notNull(),
    commandId: uuid('command_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    response: jsonb('response').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.actorId, t.commandId] })],
);
