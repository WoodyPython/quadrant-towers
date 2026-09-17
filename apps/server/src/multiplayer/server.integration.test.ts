import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  defaultRegistry,
  launchCards,
  cellKey,
  applyCommand,
  createMatch,
  projectMatch,
  PRESETS,
  fallbackTargets,
  quadrantCells,
  towerAt,
  type MatchState,
  type PresetId,
} from '@quadrant/game-engine';
import {
  ackSchema,
  matchViewSchema,
  type Ack,
  type ClientEvents,
  type ServerEvents,
  type Requests,
  type RequestEvent,
} from '@quadrant/protocol';
import { buildApp } from '../app.js';
import { createDatabase } from '../db/database.js';
import { parseEnvironment } from '../env.js';
import { Store } from './store.js';
import type { Clock } from './server.js';

type Client = Socket<ServerEvents, ClientEvents>;
type Success = Extract<Ack, { ok: true }>;
class TestClock implements Clock {
  time = 1_000_000;
  tasks = new Map<number, { at: number; callback: () => void }>();
  next = 0;
  now = () => this.time;
  schedule = (callback: () => void, delay: number) => {
    const id = this.next++;
    this.tasks.set(id, { at: this.time + delay, callback });
    return () => {
      this.tasks.delete(id);
    };
  };
  advance(ms: number) {
    this.time += ms;
    for (const [id, task] of this.tasks)
      if (task.at <= this.time) {
        this.tasks.delete(id);
        task.callback();
      }
  }
}
let admin: pg.Pool;
let database: ReturnType<typeof createDatabase>;
let databaseName: string;
let app: Awaited<ReturnType<typeof buildApp>>;
let address: string;
let store: Store;
let clock: TestClock;
let clients: Client[];
let identities: { playerId: string; token: string; code: string }[];
let packets: { player: number; event: string; data: unknown }[];

async function boot(rateLimits = false) {
  store = new Store(database.pool, defaultRegistry);
  app = await buildApp({
    environment: parseEnvironment({
      DATABASE_URL: 'postgres://localhost/test',
      LOG_LEVEL: 'silent',
      RATE_LIMITS: String(rateLimits),
    }),
    ready: database.ready,
    closeDatabase: async () => {},
    store,
    clock,
  });
  address = await app.listen({ host: '127.0.0.1', port: 0 });
}
beforeEach(async () => {
  clock = new TestClock();
  clients = [];
  identities = [];
  packets = [];
  const url = new URL(parseEnvironment(process.env).DATABASE_URL);
  admin = new pg.Pool({ connectionString: url.href });
  databaseName = `quadrant_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  database = createDatabase(url.href);
  await database.migrate();
  await boot();
});
afterEach(async () => {
  await app?.close();
  for (const client of clients ?? []) client.disconnect();
  await database?.close();
  if (databaseName)
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin?.end();
});
async function connect(transports = ['websocket']) {
  const client: Client = io(address, {
    transports,
    reconnection: false,
    forceNew: true,
  });
  const index = clients.length;
  clients.push(client);
  client.onAny((event: string, data: unknown) =>
    packets.push({ player: index, event, data }),
  );
  await new Promise<void>((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
  });
  return client;
}
async function request<K extends RequestEvent>(
  client: Client,
  event: K,
  data: Requests[K],
): Promise<Ack> {
  const response = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`No acknowledgement: ${event}`)),
      5000,
    );
    // Runtime schemas are independently exercised with deliberately malformed payloads below.
    (
      client.emit as (
        event: string,
        data: unknown,
        cb: (response: unknown) => void,
      ) => void
    )(event, data, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
  return ackSchema.parse(response);
}
function success(response: Ack): Success {
  expect(response.ok, JSON.stringify(response)).toBe(true);
  if (!response.ok) throw new Error(response.code);
  return response;
}
async function setup(preset: PresetId = 'small', playerCount = 4) {
  const host = await connect();
  const first = success(
    await request(host, 'room:create', { displayName: '  Host  ', preset }),
  );
  identities.push(first.identity!);
  for (let i = 1; i < playerCount; i++) {
    clock.time++;
    identities.push(
      success(
        await request(await connect(), 'room:join', {
          code: first.room!.code,
          displayName: `Player ${i}`,
        }),
      ).identity!,
    );
  }
  return first.room!.id;
}
async function start() {
  const response = success(
    await request(clients[0]!, 'match:start', { commandId: randomUUID() }),
  );
  const roomId = (await store.find(identities[0]!.code))!;
  let current = await state(roomId);
  while (current.phase === 'placement') {
    const player = current.players.find((p) => p.id === current.turn.playerId)!;
    const cell = quadrantCells(current.preset, player.quadrant).find(
      (c) => !towerAt(current, c),
    )!;
    success(
      await request(clients[actor(current)]!, 'placement:submit', {
        ...envelope(current),
        cell,
      }),
    );
    current = await state(roomId);
  }
  return response;
}
async function sync(index = 0) {
  return success(await request(clients[index]!, 'turn:sync', {}));
}
async function state(roomId: string) {
  return (await store.read(roomId)).state!;
}
async function reconnect() {
  clients = [];
  for (const identity of identities)
    success(
      await request(await connect(), 'room:rejoin', {
        code: identity.code,
        token: identity.token,
      }),
    );
}
function actor(state: MatchState) {
  return identities.findIndex((i) => i.playerId === state.turn.playerId);
}
function envelope(state: MatchState) {
  return {
    commandId: randomUUID(),
    matchId: state.id,
    expectedVersion: state.version,
  };
}
async function choose(
  current: MatchState,
  cardId = current.turn.cardOffer[0]!,
) {
  const definition = defaultRegistry.catalogs[
    current.cardCatalogVersion
  ]!.cards.find((c) => c.id === cardId)!;
  return request(clients[actor(current)]!, 'card:choose', {
    ...envelope(current),
    cardId,
    targets: fallbackTargets(current, current.turn.playerId, definition),
  });
}

it('starts with two connected players and closes empty seats to later joins', async () => {
  const host = await connect();
  const created = success(
    await request(host, 'room:create', {
      displayName: 'Host',
      preset: 'small',
    }),
  );
  identities.push(created.identity!);
  expect(
    await request(host, 'match:start', { commandId: randomUUID() }),
  ).toMatchObject({ code: 'PLAYERS_NOT_READY' });
  identities.push(
    success(
      await request(await connect(), 'room:join', {
        code: created.room!.code,
        displayName: 'Guest',
      }),
    ).identity!,
  );
  expect(
    packets
      .filter((packet) => packet.player === 0 && packet.event === 'room:view')
      .at(-1)?.data,
  ).toMatchObject({
    players: [{ displayName: 'Host' }, { displayName: 'Guest' }],
  });
  success(await request(host, 'match:start', { commandId: randomUUID() }));
  const match = await state(created.room!.id);
  expect(match.players).toHaveLength(2);
  expect(match.phase).toBe('placement');
  expect(match.towers).toHaveLength(0);
  expect(
    await request(await connect(), 'room:join', {
      code: created.room!.code,
      displayName: 'Late guest',
    }),
  ).toMatchObject({ code: 'ROOM_CLOSED' });
});

it('eliminates a player after the one-minute reconnect grace and awards the online survivor', async () => {
  const roomId = await setup('small', 2);
  await start();
  clients[1]!.disconnect();
  await expect
    .poll(
      async () => (await store.read(roomId)).room.players[1]!.disconnectedAt,
    )
    .toBe(clock.now());
  clock.advance(59_999);
  expect((await sync(0)).match!.result).toBeNull();
  clock.advance(1);
  const view = (await sync(0)).match!;
  expect(
    view.players.find((player) => player.id === identities[1]!.playerId),
  ).toMatchObject({ eliminated: true });
  expect(view.result).toMatchObject({
    winnerId: identities[0]!.playerId,
    reason: 'last_survivor',
  });
  expect(
    (
      await database.pool.query(
        "SELECT payload FROM match_commands WHERE match_id=$1 AND payload->>'type'='forfeit'",
        [view.matchId],
      )
    ).rows,
  ).toHaveLength(1);
});

it('deletes an empty lobby immediately and abandons an empty active room after one minute', async () => {
  const loneClient = await connect();
  const created = success(
    await request(loneClient, 'room:create', {
      displayName: 'Solo',
      preset: 'small',
    }),
  );
  success(await request(loneClient, 'room:leave', {}));
  expect(await store.find(created.room!.code)).toBeUndefined();

  clients = [];
  identities = [];
  const roomId = await setup('small', 2);
  const code = identities[0]!.code;
  await start();
  clients.at(-2)!.disconnect();
  clients.at(-1)!.disconnect();
  await expect
    .poll(async () =>
      (await store.read(roomId)).room.players.every(
        (player) => player.disconnectedAt !== null,
      ),
    )
    .toBe(true);
  clock.advance(60_000);
  await expect.poll(() => store.find(code)).toBeUndefined();
  for (const table of [
    'rooms',
    'players',
    'matches',
    'match_snapshots',
    'match_commands',
    'command_receipts',
  ])
    expect((await database.pool.query(`SELECT * FROM ${table}`)).rowCount).toBe(
      0,
    );
});

it.each(['small', 'medium', 'large', 'massive'] as const)(
  'finishes a %s match after restart, preserving projections and deterministic timeouts',
  async (preset) => {
    const roomId = await setup(preset);
    await start();
    const initial = await state(roomId);
    expect(initial.players.map((p) => p.quadrant).sort()).toEqual([
      'ne',
      'nw',
      'se',
      'sw',
    ]);
    expect((await sync()).match!.dimensions).toEqual(PRESETS[preset]);
    success(await choose(initial));
    const saved = await state(roomId);
    const before = await sync(actor(saved));
    await app.close();
    await boot();
    await reconnect();
    expect(await state(roomId)).toEqual(saved);
    expect((await sync(actor(saved))).match).toEqual(before.match);
    let expected = saved;
    let turns = 0;
    while (!expected.result) {
      clock.advance(expected.turn.deadline - clock.now());
      const transition = applyCommand(
        expected,
        null,
        { type: 'timeout' },
        clock.now(),
        defaultRegistry,
      );
      expect(transition.ok).toBe(true);
      if (!transition.ok) throw new Error(transition.error);
      expected = transition.state;
      const view = (await sync()).match!;
      expect(view.version).toBe(expected.version);
      expect(await state(roomId)).toEqual(expected);
      expect(++turns).toBeLessThanOrEqual(PRESETS[preset].rounds * 4);
    }
    const result = (await sync()).match!;
    expect(result.result).toEqual(expected.result);
    expect(result.cells.every((c) => c.visibility === 'visible')).toBe(true);
    const commands = (
      await database.pool.query(
        'SELECT * FROM match_commands WHERE match_id=$1 ORDER BY version',
        [expected.id],
      )
    ).rows;
    expect(commands).toHaveLength(expected.version + 1);
    let replay = createMatch(commands[0].payload.input, defaultRegistry);
    for (const command of commands.slice(1)) {
      const next = applyCommand(
        replay,
        command.actor_id,
        command.payload,
        Number(command.created_at),
        defaultRegistry,
      );
      if (!next.ok) throw new Error(next.error);
      replay = next.state;
    }
    expect(replay).toEqual(expected);
  },
  120_000,
);

it('enforces turns and versions, retries durably, and never exposes opponent private state', async () => {
  const roomId = await setup();
  const started = await start();
  const current = await state(roomId);
  const currentActor = actor(current);
  const other = (currentActor + 1) % 4;
  expect(
    await request(clients[other]!, 'turn:end', envelope(current)),
  ).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
  const offer = current.turn.cardOffer[0]!;
  const definition = defaultRegistry.catalogs[
    current.cardCatalogVersion
  ]!.cards.find((c) => c.id === offer)!;
  const data = {
    ...envelope(current),
    cardId: offer,
    targets: fallbackTargets(current, current.turn.playerId, definition),
  };
  const accepted = success(
    await request(clients[currentActor]!, 'card:choose', data),
  );
  expect(await request(clients[currentActor]!, 'card:choose', data)).toEqual(
    accepted,
  );
  expect(
    await request(clients[currentActor]!, 'card:choose', {
      ...data,
      cardId: 'different',
    }),
  ).toMatchObject({ code: 'COMMAND_ID_REUSED' });
  expect(
    await request(clients[currentActor]!, 'turn:end', envelope(current)),
  ).toMatchObject({ code: 'STALE_VERSION' });
  const selected = await state(roomId);
  const ownCell = selected.towers.find(
    (t) => t.ownerId === selected.turn.playerId,
  )!.cells[0]!;
  expect(
    await request(clients[currentActor]!, 'action:submit', {
      ...envelope(selected),
      action: { type: 'attack', cell: ownCell },
    }),
  ).toMatchObject({ code: 'ILLEGAL_COMMAND' });
  const target = selected.towers.find(
    (t) => t.ownerId !== selected.turn.playerId,
  )!.cells[0]!;
  const responses = await Promise.all(
    [1, 2].map(() =>
      request(clients[currentActor]!, 'action:submit', {
        ...envelope(selected),
        action: { type: 'attack', cell: target },
      }),
    ),
  );
  expect(responses.filter((r) => r.ok)).toHaveLength(1);
  expect(responses.filter((r) => !r.ok)).toEqual([
    expect.objectContaining({ code: 'STALE_VERSION' }),
  ]);
  const attacked = await state(roomId);
  success(
    await request(clients[currentActor]!, 'action:submit', {
      ...envelope(attacked),
      action: { type: 'attack', cell: target },
    }),
  );
  const done = await state(roomId);
  expect(done.turn.actionsRemaining).toBe(0);
  success(await request(clients[currentActor]!, 'turn:end', envelope(done)));
  expect((await state(roomId)).turn.number).toBe(current.turn.number + 1);
  const snapshots = await Promise.all(clients.map((_, i) => sync(i)));
  for (let i = 0; i < 4; i++) {
    const authoritative = await state(roomId);
    const { id, ...projected } = projectMatch(
      authoritative,
      identities[i]!.playerId,
    );
    expect(snapshots[i]!.match).toEqual({ matchId: id, ...projected });
    expect(snapshots[i]!.content!.cards).not.toHaveLength(0);
  }
  for (const packet of packets.filter((p) =>
    ['match:view', 'match:finished'].includes(p.event),
  )) {
    const view = matchViewSchema.parse(packet.data);
    expect(view).not.toHaveProperty('seed');
    expect(view).not.toHaveProperty('rngState');
    for (const cell of view.cells)
      if (cell.visibility === 'hidden')
        expect(Object.keys(cell).sort()).toEqual(['cell', 'visibility']);
    if (
      view.turn.playerId !== identities[packet.player]!.playerId &&
      !view.result
    )
      expect(view.turn).not.toHaveProperty('cardOffer');
  }
  const serialized = JSON.stringify(packets);
  for (const identity of identities)
    expect(serialized).not.toContain(identity.token);
  await app.close();
  await boot();
  await reconnect();
  expect(await request(clients[currentActor]!, 'card:choose', data)).toEqual(
    accepted,
  );
  expect((await sync()).match!.matchId).toBe(started.matchId);
});

it('handles seat limits, host grace, removal, replacement, and explicit departure', async () => {
  const roomId = await setup();
  const fifth = await connect(['polling']);
  expect(
    await request(fifth, 'room:join', {
      code: identities[0]!.code,
      displayName: 'Fifth',
    }),
  ).toMatchObject({ code: 'ROOM_FULL' });
  expect(
    await request(fifth, 'room:rejoin', {
      code: identities[0]!.code,
      token: 'a'.repeat(64),
    }),
  ).toMatchObject({ code: 'UNAUTHORIZED' });
  expect(
    await request(clients[1]!, 'match:start', { commandId: randomUUID() }),
  ).toMatchObject({ code: 'HOST_REQUIRED' });
  clients[0]!.disconnect();
  const pending = (await sync(1)).room!;
  expect(pending.hostPlayerId).toBe(identities[0]!.playerId);
  clock.advance(120_000);
  const transferred = (await sync(1)).room!;
  expect(transferred.hostPlayerId).toBe(identities[1]!.playerId);
  success(
    await request(clients[1]!, 'room:remove', {
      playerId: identities[0]!.playerId,
    }),
  );
  expect(
    await request(fifth, 'room:rejoin', {
      code: identities[0]!.code,
      token: identities[0]!.token,
    }),
  ).toMatchObject({ code: 'UNAUTHORIZED' });
  success(
    await request(fifth, 'room:join', {
      code: identities[0]!.code,
      displayName: 'Replacement',
    }),
  );
  const newSocket = await connect();
  success(
    await request(newSocket, 'room:rejoin', {
      code: identities[1]!.code,
      token: identities[1]!.token,
    }),
  );
  await expect.poll(() => clients[1]!.connected).toBe(false);
  success(await request(newSocket, 'room:leave', {}));
  expect((await sync(2)).room!.hostPlayerId).toBe(identities[2]!.playerId);
  const room = (await store.read(roomId)).room;
  expect(room.players).toHaveLength(3);
  expect(room.players.every((p) => p.tokenHash.length === 64)).toBe(true);
});

it('resolves an overdue turn exactly once after downtime and ignores obsolete timers', async () => {
  const roomId = await setup();
  await start();
  const saved = await state(roomId);
  const staleCallbacks = [...clock.tasks.values()].map((t) => t.callback);
  await app.close();
  clock.advance(900_000);
  await boot();
  await reconnect();
  const recovered = await state(roomId);
  expect(recovered.version).toBe(saved.version + 1);
  expect(recovered.turn.deadline).toBe(clock.now() + 90_000);
  for (const cb of staleCallbacks) cb();
  expect((await sync()).match!.version).toBe(recovered.version);
  clock.advance(90_000);
  expect(
    await request(clients[actor(recovered)]!, 'turn:end', envelope(recovered)),
  ).toMatchObject({ ok: false, code: 'STALE_VERSION' });
  expect((await state(roomId)).version).toBe(recovered.version + 1);
});

it('rolls back failed commands and retries a failed deadline without broadcasting speculative state', async () => {
  const roomId = await setup();
  await start();
  const saved = await state(roomId);
  await database.pool
    .query(`CREATE FUNCTION reject_test_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected private failure'; END $$;
    CREATE TRIGGER reject_test_command BEFORE INSERT ON match_commands FOR EACH ROW EXECUTE FUNCTION reject_test_command()`);
  const offset = packets.length;
  expect(await choose(saved)).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  expect(await state(roomId)).toEqual(saved);
  expect(
    packets.slice(offset).some((p) => p.event === 'command:accepted'),
  ).toBe(false);
  expect(JSON.stringify(packets)).not.toContain('injected private failure');
  clock.advance(90_000);
  expect(await request(clients[0]!, 'turn:sync', {})).toMatchObject({
    code: 'SERVICE_UNAVAILABLE',
  });
  expect(await state(roomId)).toEqual(saved);
  await database.pool.query(
    'DROP TRIGGER reject_test_command ON match_commands; DROP FUNCTION reject_test_command()',
  );
  clock.advance(1000);
  expect((await sync()).match!.version).toBe(saved.version + 1);
});

it('keeps votes durable and starts exactly one rematch with the same seats and preset', async () => {
  const roomId = await setup();
  await start();
  let current = await state(roomId);
  while (!current.result) {
    clock.advance(current.turn.deadline - clock.now());
    await sync();
    current = await state(roomId);
  }
  const votes = identities.map(() => ({
    commandId: randomUUID(),
    matchId: current.id,
  }));
  for (let i = 0; i < 3; i++)
    success(await request(clients[i]!, 'rematch:vote', votes[i]!));
  await app.close();
  await boot();
  await reconnect();
  expect(
    (await sync()).room!.players.filter((p) => p.rematchVote),
  ).toHaveLength(3);
  const result = success(await request(clients[3]!, 'rematch:vote', votes[3]!));
  expect(await request(clients[3]!, 'rematch:vote', votes[3]!)).toEqual(result);
  const next = await state(roomId);
  expect(next.id).not.toBe(current.id);
  expect(next.preset).toBe(current.preset);
  expect(next.players.map((p) => p.id).sort()).toEqual(
    current.players.map((p) => p.id).sort(),
  );
  expect(next.version).toBe(0);
  expect(next.turn.round).toBe(1);
  expect(
    (await database.pool.query('SELECT count(*)::int AS n FROM matches'))
      .rows[0].n,
  ).toBe(2);
}, 60_000);

it('rejects malformed network payloads and fails readiness on invalid recovery data', async () => {
  const client = await connect();
  expect(
    await request(client, 'room:create', { displayName: '', preset: 'small' }),
  ).toMatchObject({ code: 'INVALID_REQUEST' });
  expect(
    await request(client, 'room:create', {
      displayName: 'Player',
      preset: 'invalid' as PresetId,
    }),
  ).toMatchObject({ code: 'INVALID_REQUEST' });
  expect(await request(client, 'turn:sync', {})).toMatchObject({
    code: 'UNAUTHORIZED',
  });
  clients = [];
  client.disconnect();
  const roomId = await setup();
  await start();
  const current = await state(roomId);
  await app.close();
  await database.pool.query(
    'UPDATE match_snapshots SET schema_version=99 WHERE match_id=$1',
    [current.id],
  );
  await boot();
  expect((await app.inject('/health/ready')).statusCode).toBe(503);
  expect((await app.inject('/health/live')).statusCode).toBe(200);
  expect(
    await request(await connect(), 'room:rejoin', {
      code: identities[0]!.code,
      token: identities[0]!.token,
    }),
  ).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
});

it('recovers an uncertain commit and returns the original receipt after a lost acknowledgement', async () => {
  const roomId = await setup();
  await start();
  const current = await state(roomId);
  const definition = defaultRegistry.catalogs[
    current.cardCatalogVersion
  ]!.cards.find((c) => c.id === current.turn.cardOffer[0])!;
  const data = {
    ...envelope(current),
    cardId: definition.id,
    targets: fallbackTargets(current, current.turn.playerId, definition),
  };
  const original = store.transaction.bind(store);
  let failCommitResponse = true;
  const spy = vi
    .spyOn(store, 'transaction')
    .mockImplementation(async (id, operation) => {
      let acceptedCommand = false;
      const committed = await original(id, async (...args) => {
        const result = await operation(...args);
        acceptedCommand = !!result.write?.command;
        return result;
      });
      if (acceptedCommand && failCommitResponse) {
        failCommitResponse = false;
        throw new Error('Lost database commit response');
      }
      return committed;
    });
  expect(
    await request(clients[actor(current)]!, 'card:choose', data),
  ).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  spy.mockRestore();
  expect((await state(roomId)).version).toBe(current.version + 1);
  await app.close();
  await boot();
  await reconnect();
  const receipt = success(
    await request(clients[actor(current)]!, 'card:choose', data),
  );
  expect(receipt).toEqual({
    ok: true,
    commandId: data.commandId,
    matchId: current.id,
    version: current.version + 1,
  });
  expect((await state(roomId)).version).toBe(current.version + 1);

  const next = await state(roomId);
  const cell = next.towers.find((t) => t.ownerId !== next.turn.playerId)!
    .cells[0]!;
  const action = {
    ...envelope(next),
    action: { type: 'attack' as const, cell },
  };
  // Send a real command but deliberately discard its acknowledgement before restarting.
  clients[actor(next)]!.emit('action:submit', action, () => {});
  await expect
    .poll(async () => (await state(roomId)).version)
    .toBe(next.version + 1);
  await app.close();
  await boot();
  await reconnect();
  expect(await request(clients[actor(next)]!, 'action:submit', action)).toEqual(
    {
      ok: true,
      commandId: action.commandId,
      matchId: next.id,
      version: next.version + 1,
    },
  );
  expect((await state(roomId)).version).toBe(next.version + 1);
});

it('serializes concurrent joins and starts, and makes start requests idempotent across restart', async () => {
  const host = await connect();
  const created = success(
    await request(host, 'room:create', {
      displayName: 'Host',
      preset: 'medium',
    }),
  );
  identities.push(created.identity!);
  const contenders = await Promise.all([0, 1, 2, 3].map(() => connect()));
  const joined = await Promise.all(
    contenders.map((client, i) =>
      request(client, 'room:join', {
        code: created.room!.code,
        displayName: `Guest ${i}`,
      }),
    ),
  );
  expect(joined.filter((r) => r.ok)).toHaveLength(3);
  expect(joined.filter((r) => !r.ok)).toEqual([
    expect.objectContaining({ code: 'ROOM_FULL' }),
  ]);
  for (const value of joined) if (value.ok) identities.push(value.identity!);
  const data = { commandId: randomUUID() };
  const results = await Promise.all([
    request(host, 'match:start', data),
    request(host, 'match:start', data),
  ]);
  expect(results[0]).toEqual(results[1]);
  success(results[0]!);
  expect(
    (await database.pool.query('SELECT count(*)::int AS n FROM matches'))
      .rows[0].n,
  ).toBe(1);
  await app.close();
  await boot();
  await reconnect();
  expect(await request(clients[0]!, 'match:start', data)).toEqual(results[0]);
  expect(
    await request(clients[0]!, 'match:start', { commandId: randomUUID() }),
  ).toMatchObject({ code: 'ROOM_CLOSED' });
});

it('preserves a hidden passive through restart and reveals it only when triggered', async () => {
  const roomId = await setup();
  await start();
  const initial = await state(roomId);
  // Prepare a reproducible mid-match fixture using only legal engine transitions.
  let fixture: MatchState | undefined;
  for (let seed = 0; seed < 20 && !fixture; seed++) {
    let candidate = createMatch(
      {
        id: initial.id,
        playerIds: identities.map((i) => i.playerId),
        preset: 'small',
        seed,
        now: clock.now(),
        cardCatalogVersion: 'framework-1',
        balanceVersion: 'framework-1',
      },
      defaultRegistry,
    );
    while (!candidate.result) {
      if (candidate.turn.cardOffer.includes('guard')) {
        fixture = candidate;
        break;
      }
      const next = applyCommand(
        candidate,
        null,
        { type: 'timeout' },
        candidate.turn.deadline,
        defaultRegistry,
      );
      if (!next.ok) throw new Error(next.error);
      candidate = next.state;
    }
  }
  expect(fixture).toBeDefined();
  clock.time = fixture!.lastCommandAt;
  await store.transaction(roomId, async (a) => {
    a.state = fixture!;
    return { value: null, write: {} };
  });
  success(await choose(fixture!, 'guard'));
  const guarded = await state(roomId);
  const owner = actor(guarded);
  expect(guarded.effects.some((e) => e.cardId === 'guard')).toBe(true);
  for (let i = 0; i < 4; i++)
    expect(
      (await sync(i)).match!.effects.some((e) => e.cardId === 'guard'),
    ).toBe(i === owner);
  await app.close();
  await boot();
  await reconnect();
  expect(await state(roomId)).toEqual(guarded);
  const enemyCell = guarded.towers.find(
    (t) => t.ownerId !== guarded.turn.playerId,
  )!.cells[0]!;
  for (let i = 0; i < 2; i++) {
    const now = await state(roomId);
    success(
      await request(clients[owner]!, 'action:submit', {
        ...envelope(now),
        action: { type: 'attack', cell: enemyCell },
      }),
    );
  }
  success(
    await request(clients[owner]!, 'turn:end', envelope(await state(roomId))),
  );
  let now = await state(roomId);
  success(await choose(now));
  now = await state(roomId);
  const protectedTower = now.towers.find(
    (t) => t.ownerId === identities[owner]!.playerId,
  )!;
  success(
    await request(clients[actor(now)]!, 'action:submit', {
      ...envelope(now),
      action: { type: 'attack', cell: protectedTower.cells[0]! },
    }),
  );
  const after = await state(roomId);
  expect(after.towers.find((t) => t.id === protectedTower.id)!.health).toBe(
    protectedTower.health,
  );
  expect(after.effects.some((e) => e.cardId === 'guard')).toBe(false);
  for (let i = 0; i < 4; i++) {
    const view = (await sync(i)).match!;
    expect(
      view.history.some(
        (e) =>
          e.type === 'effect_triggered' &&
          (e.details?.cardId === 'guard' ||
            e.details?.publicCardId === 'guard'),
      ),
    ).toBe(true);
  }
});

it('finishes by last survivor through legal network actions and lets eliminated players reconnect', async () => {
  const roomId = await setup();
  await start();
  // Each player resolves their card and all granted actions against surviving opponents.
  let now = await state(roomId);
  for (let turns = 0; turns < 30 && !now.result; turns++) {
    const neutral = now.turn.cardOffer.find((id) => id.startsWith('neutral-'));
    if (neutral) success(await choose(now, neutral));
    else success(await choose(now));
    now = await state(roomId);
    while (
      !now.result &&
      (now.turn.actionsRemaining > 0 ||
        (now.turn.freeAttacksAvailable ?? 0) > 0)
    ) {
      now = await state(roomId);
      if (now.result) break;
      const target = now.towers.find((t) => t.ownerId !== now.turn.playerId)!;
      success(
        await request(clients[actor(now)]!, 'action:submit', {
          ...envelope(now),
          action: { type: 'attack', cell: target.cells[0]! },
        }),
      );
      now = await state(roomId);
    }
    now = await state(roomId);
    if (!now.result)
      success(await request(clients[actor(now)]!, 'turn:end', envelope(now)));
    now = await state(roomId);
  }
  expect(now.result?.reason).toBe('last_survivor');
  const loser = now.players.find((p) => p.eliminated)!;
  const index = identities.findIndex((i) => i.playerId === loser.id);
  clients[index]!.disconnect();
  const rejoined = await connect();
  const view = success(
    await request(rejoined, 'room:rejoin', {
      code: identities[index]!.code,
      token: identities[index]!.token,
    }),
  ).match!;
  expect(view.result!.scores.find((s) => s.playerId === loser.id)!.points).toBe(
    0,
  );
  expect(view.cells.every((c) => c.visibility === 'visible')).toBe(true);
});

it('rejects unapproved origins for polling and WebSocket handshakes', async () => {
  for (const transports of [['websocket'], ['polling']]) {
    const socket = io(address, {
      transports,
      forceNew: true,
      reconnection: false,
      extraHeaders: { Origin: 'https://unapproved.example' },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () =>
        reject(new Error('Unapproved origin connected')),
      );
      socket.once('connect_error', () => resolve());
    });
    socket.disconnect();
  }
});

it('records a disconnect that happens while a new seat is being committed', async () => {
  const client = await connect();
  const original = store.create.bind(store);
  const spy = vi.spyOn(store, 'create').mockImplementation(async (room) => {
    await original(room);
    client.disconnect();
    // Deliver the actual transport disconnect before the service binds identity.
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  client.emit(
    'room:create',
    { displayName: 'Departing', preset: 'small' },
    () => {},
  );
  await expect
    .poll(async () => {
      const ids = await store.ids();
      return ids.length
        ? (await store.read(ids[0]!)).room.players[0]!.disconnectedAt
        : null;
    })
    .toBe(clock.now());
  spy.mockRestore();
});

it('limits socket work before persistence, refills, and allows four players behind one IP', async () => {
  await app.close();
  await boot(true);
  await setup();
  await start();
  let limited = 0;
  for (let i = 0; i < 40; i++) {
    const response = await request(clients[0]!, 'turn:sync', {});
    if (!response.ok && response.code === 'RATE_LIMITED') limited++;
  }
  expect(limited).toBeGreaterThan(0);
  clock.advance(60_000);
  expect((await request(clients[0]!, 'turn:sync', {})).ok).toBe(true);
  expect(
    (
      await database.pool.query(
        'SELECT count(*)::int AS n FROM command_receipts',
      )
    ).rows[0].n,
  ).toBe(identities.length + 1);
});

it('expires only disconnected lobbies at the 24-hour boundary', async () => {
  const client = await connect();
  const created = success(
    await request(client, 'room:create', {
      displayName: 'Host',
      preset: 'small',
    }),
  );
  const id = created.room!.id;
  const cutoff = clock.now() + 86_400_000;
  expect(
    await store.cleanup(id, cutoff, [created.identity!.playerId]),
  ).toBeNull();
  await app.close();
  expect(await store.retentionCandidates(cutoff - 1)).not.toContain(id);
  expect(await store.retentionCandidates(cutoff)).toContain(id);
  expect(await store.cleanup(id, cutoff, [])).toEqual([
    created.identity!.playerId,
  ]);
  expect(await store.find(created.room!.code)).toBeUndefined();
  expect(await store.cleanup(id, cutoff, [])).toBeNull();
});

it('prunes expired history without removing a newer rematch, then expires the finished room', async () => {
  const roomId = await setup();
  await start();
  let current = await state(roomId);
  while (!current.result) {
    clock.advance(current.turn.deadline - clock.now());
    await sync();
    current = await state(roomId);
  }
  const firstId = current.id;
  const firstFinished = current.lastCommandAt;
  for (let i = 0; i < 4; i++)
    success(
      await request(clients[i]!, 'rematch:vote', {
        commandId: randomUUID(),
        matchId: firstId,
      }),
    );
  const nextId = (await state(roomId)).id;
  expect(
    await store.cleanup(
      roomId,
      firstFinished + 30 * 86_400_000,
      identities.map((p) => p.playerId),
    ),
  ).toBeNull();
  expect((await state(roomId)).id).toBe(nextId);
  expect(
    (await database.pool.query('SELECT id FROM matches WHERE id=$1', [firstId]))
      .rowCount,
  ).toBe(0);
  expect(
    (
      await database.pool.query(
        'SELECT * FROM command_receipts WHERE match_id=$1',
        [firstId],
      )
    ).rowCount,
  ).toBe(0);
  current = await state(roomId);
  while (!current.result) {
    clock.advance(current.turn.deadline - clock.now());
    await sync();
    current = await state(roomId);
  }
  expect(
    await store.cleanup(
      roomId,
      current.lastCommandAt + 30 * 86_400_000 - 1,
      [],
    ),
  ).toBeNull();
  expect(
    await store.cleanup(roomId, current.lastCommandAt + 30 * 86_400_000, []),
  ).toHaveLength(4);
  for (const table of [
    'rooms',
    'players',
    'matches',
    'match_snapshots',
    'match_commands',
    'command_receipts',
  ])
    expect((await database.pool.query(`SELECT * FROM ${table}`)).rowCount).toBe(
      0,
    );
}, 60_000);

it('bounds pending socket work and logs safe identifiers without private state', async () => {
  const log = vi.spyOn(app.log, 'info');
  await setup();
  await start();
  const responses = await Promise.all(
    Array.from({ length: 30 }, () => request(clients[0]!, 'turn:sync', {})),
  );
  expect(responses.some((r) => !r.ok && r.code === 'RATE_LIMITED')).toBe(true);
  expect(responses.some((r) => r.ok)).toBe(true);
  const fields = JSON.stringify(log.mock.calls);
  for (const identity of identities)
    expect(fields).not.toContain(identity.token);
  for (const secret of [
    'cardOffer',
    'rngState',
    'tokenHash',
    'seed',
    'snapshot',
  ])
    expect(fields).not.toContain(secret);
  expect(fields).toContain('Command completed');
});

it.each([
  'barricade',
  'impenetrable',
  'phoenix_protocol',
  'focused_fire',
  'kill_chain',
  'overclock',
  'time_warp',
  'mobilization',
  'expansion_plans',
  'counterintelligence',
])(
  'persists launch %s through database recovery, private sync and idempotent replay',
  async (cardId) => {
    const roomId = await setup();
    await start();
    let current = await state(roomId);
    expect(current.cardCatalogVersion).toBe('launch-2');
    expect(current.balanceVersion).toBe('launch-2');
    const definition = launchCards.find((c) => c.id === cardId)!;
    const victim = current.towers.find(
      (t) => t.ownerId !== current.turn.playerId,
    )!;
    await store.transaction(roomId, async (aggregate) => {
      const fixture = aggregate.state!;
      fixture.turn.cardOffer = [cardId, 'neutral_reserve', 'neutral_patience'];
      fixture.turn.round = 10;
      fixture.players.find((p) => p.id === fixture.turn.playerId)!.revealed =
        fixture.towers
          .filter((t) => t.ownerId !== fixture.turn.playerId)
          .map((t) => cellKey(t.cells[0]!));
      if (cardId === 'kill_chain')
        fixture.towers.find((t) => t.id === victim.id)!.health = 1;
      fixture.version++;
      return { value: null, write: {} };
    });
    current = await state(roomId);
    const data = {
      ...envelope(current),
      cardId,
      targets: fallbackTargets(current, current.turn.playerId, definition),
    };
    const selected = success(
      await request(clients[actor(current)]!, 'card:choose', data),
    );
    if (cardId === 'focused_fire' || cardId === 'kill_chain') {
      current = await state(roomId);
      success(
        await request(clients[actor(current)]!, 'action:submit', {
          ...envelope(current),
          action: { type: 'attack', cell: victim.cells[0]! },
        }),
      );
    }
    const persisted = await state(roomId);
    if (cardId === 'kill_chain')
      expect(persisted.turn.freeAttacksAvailable).toBe(1);
    if (cardId === 'focused_fire')
      expect(
        persisted.effects.find((e) => e.cardId === cardId)!.hitTowerIds,
      ).toEqual([victim.id]);
    if (cardId === 'time_warp') expect(persisted.turn.actionsRemaining).toBe(4);
    await app.close();
    await boot();
    await reconnect();
    expect(await state(roomId)).toEqual(persisted);
    for (let i = 0; i < identities.length; i++) {
      const view = (await sync(i)).match!;
      if (identities[i]!.playerId === persisted.turn.playerId)
        expect(view.turn.cardOffer).toEqual(persisted.turn.cardOffer);
      else {
        expect(view.turn.cardOffer).toBeUndefined();
        expect(
          view.effects.every(
            (e) =>
              e.targets === undefined &&
              e.shieldRemaining === undefined &&
              e.hitTowerIds === undefined,
          ),
        ).toBe(true);
      }
    }
    expect(
      await request(clients[actor(persisted)]!, 'card:choose', data),
    ).toEqual(selected);
    expect(await state(roomId)).toEqual(persisted);
    clock.advance(90001);
    await vi.waitFor(async () =>
      expect((await state(roomId)).turn.number).toBe(persisted.turn.number + 1),
    );
  },
);
