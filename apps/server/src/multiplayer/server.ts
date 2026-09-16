import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  applyCommand,
  createMatch,
  projectMatch,
  type Command,
  type EngineRegistry,
  type MatchState,
} from '@quadrant/game-engine';
import {
  ackSchema,
  contentSchema,
  matchViewSchema,
  requestSchemas,
  roomViewSchema,
  timerSchema,
  type Ack,
  type ClientEvents,
  type ServerEvents,
  type RequestEvent,
  type Requests,
  type ErrorCode,
} from '@quadrant/protocol';
import {
  Store,
  type Aggregate,
  type Room,
  type Seat,
  type Write,
} from './store.js';

export interface Clock {
  now(): number;
  schedule(callback: () => void, delay: number): () => void;
}
const systemClock: Clock = {
  now: Date.now,
  schedule(callback, delay) {
    const timer = setTimeout(callback, delay);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
interface Identity {
  roomId?: string;
  playerId?: string;
}
type GameSocket = Socket<
  ClientEvents,
  ServerEvents,
  Record<string, never>,
  Identity
>;
class Fault extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
const messages: Record<ErrorCode, string> = {
  INVALID_REQUEST: 'The request is invalid.',
  UNAUTHORIZED: 'Rejoin your player seat.',
  ALREADY_SEATED: 'Leave your current room first.',
  ROOM_NOT_FOUND: 'Room not found.',
  ROOM_FULL: 'The room is full.',
  ROOM_CLOSED: 'The room is closed to new players.',
  HOST_REQUIRED: 'Only the host can do that.',
  PLAYERS_NOT_READY: 'Four connected players are required.',
  SEAT_NOT_REMOVABLE: 'That seat cannot be removed yet.',
  MATCH_NOT_FOUND: 'Match not found.',
  MATCH_FINISHED: 'The match has finished.',
  STALE_VERSION: 'Synchronize the match and try again.',
  COMMAND_ID_REUSED: 'Use a new command ID for a different request.',
  NOT_YOUR_TURN: 'It is not your turn.',
  DEADLINE_ELAPSED: 'The turn deadline has elapsed.',
  ILLEGAL_COMMAND: 'That command is not legal.',
  MATCH_NOT_FINISHED: 'Finish the current match before voting.',
  SERVICE_UNAVAILABLE:
    'The service is temporarily unavailable. Retry or reconnect.',
};
function rejection(code: ErrorCode): Extract<Ack, { ok: false }> {
  return { ok: false, code, message: messages[code] };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
class Queues {
  private tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const task = (this.tails.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(operation);
    this.tails.set(key, task);
    void task
      .finally(() => {
        if (this.tails.get(key) === task) this.tails.delete(key);
      })
      .catch(() => {});
    return task;
  }
  async drain() {
    while (this.tails.size) await Promise.allSettled([...this.tails.values()]);
  }
}

export interface MultiplayerOptions {
  httpServer: HttpServer;
  store: Store;
  origins: string[];
  clock?: Clock;
  catalogVersion?: string;
  balanceVersion?: string;
  log?: (fields: Record<string, unknown>, message: string) => void;
}
export class Multiplayer {
  readonly io: Server<
    ClientEvents,
    ServerEvents,
    Record<string, never>,
    Identity
  >;
  private readonly store: Store;
  private readonly registry: EngineRegistry;
  private readonly clock: Clock;
  private readonly queues = new Queues();
  private readonly connections = new Map<string, GameSocket>();
  private readonly timers = new Map<string, () => void>();
  private readonly hot = new Map<string, Aggregate>();
  private readonly catalogVersion: string;
  private readonly balanceVersion: string;
  private closing = false;
  private recovered = false;
  constructor(private readonly options: MultiplayerOptions) {
    this.store = options.store;
    this.registry = options.store.registry;
    this.clock = options.clock ?? systemClock;
    this.catalogVersion = options.catalogVersion ?? 'framework-1';
    this.balanceVersion = options.balanceVersion ?? 'framework-1';
    this.io = new Server(options.httpServer, {
      maxHttpBufferSize: 16 * 1024,
      cors: { origin: options.origins, methods: ['GET', 'POST'] },
      allowRequest: (request, callback) =>
        callback(
          null,
          !request.headers.origin ||
            options.origins.includes(request.headers.origin),
        ),
    });
    this.io.on('connection', (socket) => {
      for (const event of Object.keys(requestSchemas) as RequestEvent[]) {
        socket.on(event, ((raw: unknown, acknowledge: unknown) => {
          if (typeof acknowledge !== 'function') return;
          void this.queues
            .run(`socket:${socket.id}`, async () => {
              let response: Ack;
              try {
                if (!this.ready() || !socket.connected)
                  throw new Fault('SERVICE_UNAVAILABLE');
                const parsed = requestSchemas[event].safeParse(raw);
                if (!parsed.success) throw new Fault('INVALID_REQUEST');
                response = await this.dispatch(socket, event, parsed.data);
              } catch (error) {
                response = rejection(
                  error instanceof Fault ? error.code : 'SERVICE_UNAVAILABLE',
                );
                if (!(error instanceof Fault))
                  this.options.log?.({ event }, 'Multiplayer operation failed');
              }
              response = ackSchema.parse(response);
              acknowledge(response);
              if (!response.ok) socket.emit('command:rejected', response);
              else if (response.commandId)
                socket.emit('command:accepted', response);
            })
            .catch(() => {
              socket.emit('server:error', rejection('SERVICE_UNAVAILABLE'));
            });
        }) as never);
      }
      socket.on('disconnect', () => this.disconnected(socket));
    });
  }
  ready() {
    return this.recovered && !this.closing;
  }
  async recover() {
    try {
      const ids = await this.store.ids();
      // Validate every current snapshot before arming any timer or accepting traffic.
      for (const id of ids) await this.store.read(id);
      for (const id of ids) {
        const { aggregate } = await this.store.transaction(
          id,
          async ({ room }) => {
            for (const p of room.players) p.disconnectedAt ??= this.clock.now();
            return { value: null, write: {} };
          },
        );
        this.hot.set(id, aggregate);
      }
      for (const id of ids) await this.expire(id);
      this.recovered = true;
      for (const value of this.hot.values()) this.arm(value);
    } catch {
      this.recovered = false;
      for (const cancel of this.timers.values()) cancel();
      this.timers.clear();
      this.options.log?.({}, 'Multiplayer recovery failed');
    }
  }
  private identity(socket: GameSocket, room?: Room): string {
    const id = socket.data.playerId;
    if (
      !id ||
      !socket.connected ||
      this.connections.get(id) !== socket ||
      (room && !room.players.some((p) => p.id === id))
    )
      throw new Fault('UNAUTHORIZED');
    return id;
  }
  private connected(id: string) {
    return this.connections.get(id)?.connected === true;
  }
  private bind(socket: GameSocket, roomId: string, playerId: string) {
    const previous = this.connections.get(playerId);
    socket.data = { roomId, playerId };
    this.connections.set(playerId, socket);
    if (previous && previous !== socket) previous.disconnect(true);
    // A socket may disappear while its seat transaction is committing, before
    // the disconnect listener has an identity to record.
    if (!socket.connected) this.disconnected(socket);
  }
  private roomView(room: Room) {
    return roomViewSchema.parse({
      id: room.id,
      code: room.code,
      preset: room.preset,
      status: room.status,
      hostPlayerId: room.hostPlayerId,
      matchId: room.matchId,
      players: room.players.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        seat: p.seat,
        connected: this.connected(p.id),
        removableAt:
          room.status === 'lobby' &&
          !this.connected(p.id) &&
          p.disconnectedAt !== null
            ? p.disconnectedAt + 120_000
            : null,
        rematchVote:
          room.status === 'finished' && p.rematchVote === room.matchId,
      })),
    });
  }
  private view(state: MatchState, playerId: string) {
    const { id, ...projection } = projectMatch(state, playerId);
    return matchViewSchema.parse({ matchId: id, ...projection });
  }
  private content(state: MatchState) {
    return contentSchema.parse({
      cardCatalogVersion: state.cardCatalogVersion,
      balanceVersion: state.balanceVersion,
      cards: this.registry.catalogs[state.cardCatalogVersion]!.cards.map(
        (c) => ({
          id: c.id,
          version: c.version,
          name: c.name,
          description: c.description,
          rarityId: c.rarityId,
          lifecycle: c.lifecycle,
          artKey: c.artKey,
          targets: c.targets.map((t) => ({
            id: t.id,
            kind: t.kind,
            timing: t.timing,
          })),
        }),
      ),
      rarities: this.registry.balances[state.balanceVersion]!.rarities.map(
        (r) => ({
          id: r.id,
          rank: r.rank,
          label: r.label,
          icon: r.icon,
          color: r.color,
        }),
      ),
    });
  }
  private sync(aggregate: Aggregate, playerId: string): Ack {
    return {
      ok: true,
      room: this.roomView(aggregate.room),
      serverTime: this.clock.now(),
      ...(aggregate.state
        ? {
            match: this.view(aggregate.state, playerId),
            content: this.content(aggregate.state),
          }
        : {}),
    };
  }
  private publish(aggregate: Aggregate) {
    this.hot.set(aggregate.room.id, aggregate);
    this.arm(aggregate);
    for (const player of aggregate.room.players) {
      const socket = this.connections.get(player.id);
      if (!socket?.connected) continue;
      socket.emit('room:view', this.roomView(aggregate.room));
      if (aggregate.state) {
        const view = this.view(aggregate.state, player.id);
        socket.emit('match:view', view);
        if (aggregate.state.result) socket.emit('match:finished', view);
        else
          socket.emit(
            'turn:timer',
            timerSchema.parse({
              matchId: aggregate.state.id,
              version: aggregate.state.version,
              deadline: aggregate.state.turn.deadline,
              serverTime: this.clock.now(),
            }),
          );
      }
    }
  }
  private transferHost(room: Room) {
    if (room.status !== 'lobby') return;
    const host = room.players.find((p) => p.id === room.hostPlayerId);
    if (
      host &&
      (this.connected(host.id) ||
        host.disconnectedAt === null ||
        host.disconnectedAt + 120_000 > this.clock.now())
    )
      return;
    room.hostPlayerId =
      room.players.find((p) => this.connected(p.id))?.id ?? room.hostPlayerId;
  }
  private start(aggregate: Aggregate) {
    aggregate.state = createMatch(
      {
        id: randomUUID(),
        playerIds: aggregate.room.players.map((p) => p.id),
        preset: aggregate.room.preset,
        seed: randomBytes(4).readUInt32LE(),
        now: this.clock.now(),
        cardCatalogVersion: this.catalogVersion,
        balanceVersion: this.balanceVersion,
      },
      this.registry,
    );
    aggregate.room.matchId = aggregate.state.id;
    aggregate.room.status = 'active';
    for (const p of aggregate.room.players) p.rematchVote = null;
  }
  private rematchReady(room: Room, reconnecting?: string) {
    return (
      room.status === 'finished' &&
      room.players.length === 4 &&
      room.players.every(
        (p) =>
          p.rematchVote === room.matchId &&
          (this.connected(p.id) || p.id === reconnecting),
      )
    );
  }
  private async dispatch(
    socket: GameSocket,
    event: RequestEvent,
    input: Requests[RequestEvent],
  ): Promise<Ack> {
    if (
      event === 'room:create' ||
      event === 'room:join' ||
      event === 'room:rejoin'
    ) {
      if (socket.data.playerId) throw new Fault('ALREADY_SEATED');
      if (event === 'room:create') {
        const data = input as Requests['room:create'];
        const token = randomBytes(32).toString('hex');
        const player = this.seat(data.displayName, token, 0);
        for (let attempt = 0; attempt < 8; attempt++) {
          const room: Room = {
            id: randomUUID(),
            code: Array.from({ length: 6 }, () =>
              String.fromCharCode(65 + randomInt(26)),
            ).join(''),
            preset: data.preset,
            status: 'lobby',
            hostPlayerId: player.id,
            matchId: null,
            createdAt: this.clock.now(),
            players: [player],
          };
          try {
            await this.store.create(room);
          } catch (error) {
            if (
              (error as { code?: string; constraint?: string }).code ===
                '23505' &&
              (error as { constraint?: string }).constraint ===
                'rooms_code_unique'
            )
              continue;
            throw error;
          }
          this.bind(socket, room.id, player.id);
          this.publish({ room, state: null });
          return {
            ok: true,
            identity: { playerId: player.id, token, code: room.code },
            room: this.roomView(room),
          };
        }
        throw new Fault('SERVICE_UNAVAILABLE');
      }
      const data = input as Requests['room:join'] | Requests['room:rejoin'];
      const roomId = await this.store.find(data.code);
      if (!roomId) throw new Fault('ROOM_NOT_FOUND');
      return this.queues.run(`room:${roomId}`, async () => {
        const token =
          'token' in data ? data.token : randomBytes(32).toString('hex');
        const { value: playerId, aggregate } = await this.store.transaction(
          roomId,
          async (aggregate) => {
            const room = aggregate.room;
            if (room.status === 'closed') throw new Fault('ROOM_CLOSED');
            let player: Seat;
            if ('token' in data) {
              const found = room.players.find(
                (p) => p.tokenHash === hash(token),
              );
              if (!found) throw new Fault('UNAUTHORIZED');
              // An expired absent host must not reclaim ownership ahead of connected players.
              this.transferHost(room);
              player = found;
            } else {
              if (room.status !== 'lobby') throw new Fault('ROOM_CLOSED');
              if (room.players.length === 4) throw new Fault('ROOM_FULL');
              const seat = [0, 1, 2, 3].find(
                (i) => !room.players.some((p) => p.seat === i),
              )!;
              player = this.seat(data.displayName, token, seat);
              player.joinedAt = Math.max(
                player.joinedAt,
                ...room.players.map((p) => p.joinedAt + 1),
              );
              room.players.push(player);
            }
            const host = room.players.find((p) => p.id === room.hostPlayerId);
            if (
              room.status === 'lobby' &&
              (!host ||
                (!this.connected(host.id) &&
                  host.disconnectedAt !== null &&
                  host.disconnectedAt + 120_000 <= this.clock.now()))
            )
              room.hostPlayerId = player.id;
            player.disconnectedAt = null;
            if (this.rematchReady(room, player.id)) this.start(aggregate);
            return { value: player.id, write: {} };
          },
        );
        this.bind(socket, roomId, playerId);
        this.publish(aggregate);
        return {
          ...this.sync(aggregate, playerId),
          identity: { playerId, token, code: aggregate.room.code },
        } as Ack;
      });
    }
    this.identity(socket);
    const roomId = socket.data.roomId!;
    return this.queues.run(`room:${roomId}`, async () => {
      this.identity(socket);
      // Synchronization and gameplay both observe an expired turn only after its durable timeout.
      await this.expire(roomId);
      const run = async (): Promise<Ack> => {
        const { value, aggregate } = await this.store.transaction<Ack>(
          roomId,
          async (aggregate, receipt) => {
            const { room } = aggregate;
            const actor = this.identity(socket, room);
            const commandId =
              'commandId' in input ? input.commandId : undefined;
            const fingerprint = hash(canonical({ event, input }));
            if (commandId) {
              const previous = await receipt(actor, commandId);
              if (previous) {
                if (previous.fingerprint !== fingerprint)
                  throw new Fault('COMMAND_ID_REUSED');
                return { value: previous.response };
              }
            }
            let response: Ack = { ok: true };
            const write: Write = {};
            if (event === 'turn:sync')
              return { value: this.sync(aggregate, actor) };
            if (event === 'room:leave') {
              if (room.status === 'lobby') {
                room.players = room.players.filter((p) => p.id !== actor);
                if (room.hostPlayerId === actor)
                  room.hostPlayerId =
                    room.players.find((p) => this.connected(p.id))?.id ?? null;
                if (!room.players.length) room.status = 'closed';
              } else
                room.players.find((p) => p.id === actor)!.disconnectedAt =
                  this.clock.now();
            } else if (event === 'room:remove') {
              if (room.hostPlayerId !== actor) throw new Fault('HOST_REQUIRED');
              const target = room.players.find(
                (p) => p.id === (input as Requests['room:remove']).playerId,
              );
              if (
                room.status !== 'lobby' ||
                !target ||
                target.id === actor ||
                this.connected(target.id) ||
                target.disconnectedAt === null ||
                target.disconnectedAt + 120_000 > this.clock.now()
              )
                throw new Fault('SEAT_NOT_REMOVABLE');
              room.players = room.players.filter((p) => p.id !== target.id);
            } else if (event === 'match:start') {
              if (room.hostPlayerId !== actor) throw new Fault('HOST_REQUIRED');
              if (room.status !== 'lobby') throw new Fault('ROOM_CLOSED');
              if (
                room.players.length !== 4 ||
                room.players.some((p) => !this.connected(p.id))
              )
                throw new Fault('PLAYERS_NOT_READY');
              this.start(aggregate);
              response = {
                ok: true,
                commandId: commandId!,
                matchId: aggregate.state!.id,
                version: aggregate.state!.version,
              };
            } else if (event === 'rematch:vote') {
              if (
                !aggregate.state ||
                aggregate.state.id !==
                  (input as Requests['rematch:vote']).matchId
              )
                throw new Fault('MATCH_NOT_FOUND');
              if (!aggregate.state.result)
                throw new Fault('MATCH_NOT_FINISHED');
              room.players.find((p) => p.id === actor)!.rematchVote =
                aggregate.state.id;
              if (this.rematchReady(room)) this.start(aggregate);
              response = {
                ok: true,
                commandId: commandId!,
                matchId: aggregate.state.id,
                version: aggregate.state.version,
              };
            } else {
              const request = input as
                | Requests['action:submit']
                | Requests['card:choose']
                | Requests['turn:end'];
              const state = aggregate.state;
              if (!state || state.id !== request.matchId)
                throw new Fault('MATCH_NOT_FOUND');
              if (state.result) throw new Fault('MATCH_FINISHED');
              if (state.version !== request.expectedVersion)
                throw new Fault('STALE_VERSION');
              if (state.turn.playerId !== actor)
                throw new Fault('NOT_YOUR_TURN');
              if (this.clock.now() >= state.turn.deadline)
                throw new Fault('DEADLINE_ELAPSED');
              const command: Command =
                event === 'card:choose'
                  ? {
                      type: 'select_card',
                      cardId: (request as Requests['card:choose']).cardId,
                      targets: (request as Requests['card:choose']).targets,
                    }
                  : event === 'action:submit'
                    ? (request as Requests['action:submit']).action
                    : { type: 'end_turn' };
              const next = applyCommand(
                state,
                actor,
                command,
                Math.max(this.clock.now(), state.lastCommandAt),
                this.registry,
              );
              if (!next.ok) throw new Fault('ILLEGAL_COMMAND');
              aggregate.state = next.state;
              if (next.state.result) room.status = 'finished';
              write.command = {
                actorId: actor,
                commandId: request.commandId,
                payload: command,
              };
              response = {
                ok: true,
                commandId: request.commandId,
                matchId: state.id,
                version: next.state.version,
              };
            }
            if (commandId)
              write.receipt = {
                actorId: actor,
                commandId,
                fingerprint,
                response,
              };
            return { value: response, write };
          },
        );
        if (event === 'room:leave') {
          this.connections.delete(socket.data.playerId!);
          socket.data = {};
        }
        this.publish(aggregate);
        if (value.ok && value.commandId)
          this.options.log?.(
            {
              matchId: value.matchId,
              playerId: socket.data.playerId,
              version: value.version,
              commandId: value.commandId,
            },
            'Command accepted',
          );
        return value;
      };
      const matchId = this.hot.get(roomId)?.state?.id;
      try {
        return await (matchId
          ? this.queues.run(`match:${matchId}`, run)
          : run());
      } catch (error) {
        // A commit can succeed even if its response is lost. Never reuse speculative memory.
        if (!(error instanceof Fault)) {
          try {
            const actual = await this.store.read(roomId);
            this.hot.set(roomId, actual);
            this.arm(actual);
          } catch {
            this.retry(roomId);
          }
        }
        throw error;
      }
    });
  }
  private seat(displayName: string, token: string, seat: number): Seat {
    return {
      id: randomUUID(),
      displayName,
      seat,
      tokenHash: hash(token),
      joinedAt: this.clock.now(),
      disconnectedAt: null,
      rematchVote: null,
    };
  }
  private disconnected(socket: GameSocket) {
    const { playerId, roomId } = socket.data;
    if (!playerId || !roomId || this.connections.get(playerId) !== socket)
      return;
    this.connections.delete(playerId);
    if (this.closing) return;
    void this.queues
      .run(`room:${roomId}`, async () => {
        const { aggregate } = await this.store.transaction(
          roomId,
          async ({ room }) => {
            const player = room.players.find((p) => p.id === playerId);
            if (player && !this.connected(playerId))
              player.disconnectedAt = this.clock.now();
            return { value: null, write: {} };
          },
        );
        this.publish(aggregate);
      })
      .catch(() => this.retry(roomId));
  }
  private async expire(roomId: string) {
    const { value: changed, aggregate } = await this.store.transaction(
      roomId,
      async (aggregate) => {
        const { room, state } = aggregate;
        // Repair presence after a transient database failure during disconnect.
        let changed = false;
        for (const p of room.players)
          if (!this.connected(p.id) && p.disconnectedAt === null) {
            p.disconnectedAt = this.clock.now();
            changed = true;
          }
        const host = room.hostPlayerId;
        this.transferHost(room);
        changed ||= host !== room.hostPlayerId;
        if (state && !state.result && this.clock.now() >= state.turn.deadline) {
          const next = applyCommand(
            state,
            null,
            { type: 'timeout' },
            Math.max(this.clock.now(), state.lastCommandAt),
            this.registry,
          );
          if (!next.ok) throw new Error('Timeout failed');
          aggregate.state = next.state;
          if (next.state.result) room.status = 'finished';
          return {
            value: true,
            write: {
              command: {
                actorId: null,
                commandId: `timeout:${state.turn.number}`,
                payload: { type: 'timeout' } as Command,
              },
            },
          };
        }
        return { value: changed, ...(changed ? { write: {} } : {}) };
      },
    );
    this.hot.set(roomId, aggregate);
    if (changed && this.recovered) this.publish(aggregate);
    return aggregate;
  }
  private retry(roomId: string) {
    if (this.closing) return;
    this.timers.get(roomId)?.();
    this.timers.set(
      roomId,
      this.clock.schedule(() => this.tick(roomId), 1000),
    );
  }
  private tick(roomId: string) {
    if (this.closing) return;
    void this.queues
      .run(`room:${roomId}`, async () => {
        const aggregate = await this.expire(roomId);
        this.arm(aggregate);
      })
      .catch(() => this.retry(roomId));
  }
  private arm({ room, state }: Aggregate) {
    this.timers.get(room.id)?.();
    this.timers.delete(room.id);
    if (!this.ready()) return;
    let deadline: number | undefined;
    if (state && !state.result) deadline = state.turn.deadline;
    else if (room.status === 'lobby') {
      const host = room.players.find((p) => p.id === room.hostPlayerId);
      if (
        host &&
        !this.connected(host.id) &&
        host.disconnectedAt !== null &&
        host.disconnectedAt + 120_000 > this.clock.now()
      )
        deadline = host.disconnectedAt + 120_000;
    }
    if (deadline !== undefined)
      this.timers.set(
        room.id,
        this.clock.schedule(
          () => this.tick(room.id),
          Math.max(0, deadline - this.clock.now()),
        ),
      );
  }
  async close() {
    this.closing = true;
    for (const cancel of this.timers.values()) cancel();
    this.timers.clear();
    await this.queues.drain();
    for (const roomId of new Set(
      [...this.connections.values()].map((s) => s.data.roomId!),
    )) {
      await this.store
        .transaction(roomId, async ({ room }) => {
          for (const p of room.players)
            if (this.connected(p.id)) p.disconnectedAt = this.clock.now();
          return { value: null, write: {} };
        })
        .catch(() => {});
    }
    this.io.disconnectSockets(true);
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
  }
}
