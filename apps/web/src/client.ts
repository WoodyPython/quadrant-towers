import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import {
  ackSchema,
  contentSchema,
  matchViewSchema,
  roomViewSchema,
  timerSchema,
  requestSchemas,
  type Ack,
  type ClientEvents,
  type ServerEvents,
  type MatchView,
  type RoomView,
  type Requests,
  type RequestEvent,
} from '@quadrant/protocol';
import { shouldReplace } from './board-model';

type Content = ReturnType<typeof contentSchema.parse>;
type Identity = { playerId: string; token: string; code: string };
type Pending = { event: RequestEvent; payload: Requests[RequestEvent] };
type Connection = 'connecting' | 'online' | 'offline' | 'syncing' | 'replaced';
interface State {
  identity: Identity | null;
  room: RoomView | null;
  match: MatchView | null;
  content: Content | null;
  connection: Connection;
  pending: Pending | null;
  uncertain: boolean;
  error: string | null;
  storageWarning: boolean;
  offset: number;
  home: boolean;
}
const storageKey = 'quadrant-towers:seat';
export function readIdentity(): Identity | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!raw || typeof raw !== 'object') return null;
    const v = raw as Identity;
    return typeof v.playerId === 'string' &&
      typeof v.token === 'string' &&
      /^[a-f0-9]{64}$/.test(v.token) &&
      typeof v.code === 'string' &&
      /^[A-Z]{6}$/.test(v.code)
      ? v
      : null;
  } catch {
    return null;
  }
}
export const useGame = create<State>(() => ({
  identity: readIdentity(),
  room: null,
  match: null,
  content: null,
  connection: 'connecting',
  pending: null,
  uncertain: false,
  error: null,
  storageWarning: false,
  offset: 0,
  home: false,
}));
const set = useGame.setState;
let socket: Socket<ServerEvents, ClientEvents> | undefined;
let epoch = 0;
let roomRevision = 0;
let syncPromise: Promise<void> | null = null;
function identity(value: Identity | null) {
  try {
    if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    else localStorage.removeItem(storageKey);
  } catch {
    set({ storageWarning: true });
  }
  set({ identity: value });
}
function receiveMatch(raw: MatchView) {
  const parsed = matchViewSchema.safeParse(raw);
  if (!parsed.success) {
    set({
      error: 'The game update could not be read. Reconnect to try again.',
    });
    return;
  }
  const next = parsed.data;
  const state = useGame.getState();
  if (!shouldReplace(state.match, next, state.room?.matchId)) return;
  const gap =
    state.match?.matchId === next.matchId &&
    next.version > state.match.version + 1;
  const needsContent =
    state.content?.cardCatalogVersion !== next.cardCatalogVersion ||
    state.content?.balanceVersion !== next.balanceVersion;
  set({ match: next, ...(needsContent ? { content: null } : {}) });
  if (gap || needsContent) void synchronize();
}
function receiveAck(
  ack: Extract<Ack, { ok: true }>,
  requestedRevision = roomRevision,
) {
  if (ack.identity) identity(ack.identity);
  // A late sync acknowledgement must not roll a rematch or presence update back.
  if (ack.room && requestedRevision === roomRevision) set({ room: ack.room });
  const currentMatchId = useGame.getState().room?.matchId;
  if (ack.content && (!ack.match || ack.match.matchId === currentMatchId))
    set({ content: ack.content });
  if (ack.match) receiveMatch(ack.match);
  if (ack.serverTime !== undefined)
    set({ offset: ack.serverTime - Date.now() });
}
function rawRequest(
  event: RequestEvent,
  payload: Requests[RequestEvent],
): Promise<Ack> {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error('offline'));
      return;
    }
    // The connected check and emit are synchronous: never enqueue while offline.
    // Reliable packets must survive the polling-to-WebSocket upgrade; volatile
    // emits can silently discard rejoin requests during that transition.
    const emit = socket.timeout(7000).emit.bind(socket) as unknown as (
      event: RequestEvent,
      payload: Requests[RequestEvent],
      callback: (error: Error | null, response: unknown) => void,
    ) => void;
    emit(event, payload, (error, response) => {
      if (error) {
        reject(error);
        return;
      }
      const ack = ackSchema.safeParse(response);
      if (!ack.success) {
        reject(new Error('invalid response'));
        return;
      }
      resolve(ack.data);
    });
  });
}
export async function synchronize() {
  if (syncPromise || !socket?.connected || !useGame.getState().identity)
    return syncPromise;
  const generation = epoch;
  const requestedRevision = roomRevision;
  set({ connection: 'syncing' });
  syncPromise = (async () => {
    try {
      const ack = await rawRequest('turn:sync', {});
      if (generation !== epoch) return;
      if (!ack.ok) {
        set({ error: ack.message, connection: 'offline' });
        return;
      }
      receiveAck(ack, requestedRevision);
      set({ connection: 'online' });
    } catch {
      if (generation === epoch)
        set({
          connection: 'offline',
          error: 'Could not sync. Reconnect to try again.',
        });
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}
export function connect() {
  if (socket) return;
  socket = io({ autoConnect: false });
  socket.on('connect', () => {
    const generation = ++epoch;
    const requestedRevision = roomRevision;
    const seat = useGame.getState().identity;
    if (!seat || useGame.getState().home) {
      set({ connection: 'online' });
      return;
    }
    set({ connection: 'syncing' });
    void rawRequest('room:rejoin', { code: seat.code, token: seat.token })
      .then((ack) => {
        if (generation !== epoch) return;
        if (ack.ok) {
          receiveAck(ack, requestedRevision);
          set({ connection: 'online' });
        } else {
          if (
            ['UNAUTHORIZED', 'ROOM_CLOSED', 'ROOM_NOT_FOUND'].includes(ack.code)
          ) {
            identity(null);
            set({
              room: null,
              match: null,
              content: null,
              pending: null,
              uncertain: false,
            });
          }
          set({ error: ack.message, connection: 'online' });
        }
      })
      .catch(() => {
        if (generation === epoch)
          set({
            connection: 'offline',
            error: 'Could not restore your seat. Try reconnecting.',
          });
      });
  });
  socket.on('disconnect', (reason) => {
    epoch++;
    const pending = useGame.getState().pending;
    const canRetry = pending && 'commandId' in pending.payload;
    set({
      connection: reason === 'io server disconnect' ? 'replaced' : 'offline',
      ...(pending
        ? {
            pending: canRetry ? pending : null,
            uncertain: !!canRetry,
            error: canRetry
              ? 'Connection interrupted. Check the result before making another move.'
              : 'Connection interrupted. Reconnect before trying again.',
          }
        : {}),
    });
  });
  socket.on('connect_error', () => set({ connection: 'offline' }));
  socket.on('room:view', (raw) => {
    const result = roomViewSchema.safeParse(raw);
    if (result.success) {
      roomRevision++;
      set({ room: result.data });
    }
  });
  socket.on('match:view', receiveMatch);
  socket.on('match:finished', receiveMatch);
  socket.on('turn:timer', (raw) => {
    const result = timerSchema.safeParse(raw);
    const current = useGame.getState().match;
    if (
      result.success &&
      result.data.matchId === current?.matchId &&
      result.data.version === current.version
    )
      set({ offset: result.data.serverTime - Date.now() });
  });
  socket.on('server:error', (raw) => {
    const result = ackSchema.safeParse(raw);
    if (
      result.success &&
      !result.data.ok &&
      result.data.code === 'ROOM_NOT_FOUND'
    ) {
      identity(null);
      set({
        room: null,
        match: null,
        content: null,
        pending: null,
        uncertain: false,
        home: true,
      });
    }
    if (result.success && !result.data.ok) set({ error: result.data.message });
  });
  socket.connect();
}
export function reconnect() {
  epoch++;
  syncPromise = null;
  set({ connection: 'connecting', error: null });
  socket?.disconnect();
  socket?.connect();
}
export function resume() {
  set({ home: false });
  reconnect();
}
export async function send<K extends RequestEvent>(
  event: K,
  payload: Requests[K],
  retry = false,
): Promise<boolean> {
  const state = useGame.getState();
  if (state.connection !== 'online' || (state.pending && !retry)) return false;
  const parsed = requestSchemas[event].safeParse(payload);
  if (!parsed.success) {
    set({ error: 'Check your name and room code, then try again.' });
    return false;
  }
  const generation = epoch;
  const requestedRevision = roomRevision;
  const pending = { event, payload: parsed.data };
  set({ pending, uncertain: false, error: null });
  try {
    const ack = await rawRequest(event, parsed.data);
    if (generation !== epoch) return false;
    if (!ack.ok) {
      set({ pending: null, uncertain: false, error: ack.message });
      if (
        [
          'STALE_VERSION',
          'NOT_YOUR_TURN',
          'DEADLINE_ELAPSED',
          'MATCH_NOT_FOUND',
          'MATCH_FINISHED',
        ].includes(ack.code)
      )
        await synchronize();
      return false;
    }
    receiveAck(ack, requestedRevision);
    set({ pending: null, uncertain: false });
    if ('commandId' in payload) await synchronize();
    return true;
  } catch {
    if (generation === epoch) {
      const canRetry = 'commandId' in payload;
      set({
        pending: canRetry ? pending : null,
        uncertain: canRetry,
        error: canRetry
          ? 'Waiting for confirmation. Check the result before making another move.'
          : 'No confirmation received. Reconnect before trying again.',
      });
      if (!canRetry) set({ connection: 'offline' });
    }
    return false;
  }
}
export async function retryPending() {
  const pending = useGame.getState().pending;
  await synchronize();
  if (pending && 'commandId' in pending.payload)
    await send(pending.event, pending.payload, true);
}
export async function leave() {
  const lobby = useGame.getState().room?.status === 'lobby';
  if (!(await send('room:leave', {}))) return;
  if (lobby) identity(null);
  set({ room: null, match: null, content: null, home: true });
}
export function forgetSeat() {
  identity(null);
  set({
    home: true,
    room: null,
    match: null,
    content: null,
    pending: null,
    uncertain: false,
  });
  reconnect();
}
export function mutation() {
  const match = useGame.getState().match;
  if (!match) throw new Error('No active match');
  return {
    commandId: crypto.randomUUID(),
    matchId: match.matchId,
    expectedVersion: match.version,
  };
}
