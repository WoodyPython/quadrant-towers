import { beforeEach, expect, it, vi } from 'vitest';
import type { Ack, RequestEvent, Requests } from '@quadrant/protocol';

const transport = vi.hoisted(() => {
  const listeners = new Map<string, (value?: unknown) => void>();
  const sent: {
    event: RequestEvent;
    payload: Requests[RequestEvent];
    callback: (error: Error | null, ack?: Ack) => void;
  }[] = [];
  const socket = {
    connected: true,
    on(event: string, handler: (value?: unknown) => void) {
      listeners.set(event, handler);
    },
    get volatile() {
      return socket;
    },
    timeout() {
      return socket;
    },
    emit(
      event: RequestEvent,
      payload: Requests[RequestEvent],
      callback: (error: Error | null, ack?: Ack) => void,
    ) {
      sent.push({ event, payload, callback });
    },
    connect() {
      socket.connected = true;
      listeners.get('connect')?.();
    },
    disconnect() {
      socket.connected = false;
      listeners.get('disconnect')?.('io client disconnect');
    },
  };
  return { socket, sent, listeners };
});
vi.mock('socket.io-client', () => ({ io: () => transport.socket }));
beforeEach(() => {
  vi.resetModules();
  transport.sent.length = 0;
  transport.listeners.clear();
  transport.socket.connected = true;
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});
const payload = {
  commandId: '00000000-0000-4000-8000-000000000001',
  matchId: '00000000-0000-4000-8000-000000000002',
  expectedVersion: 3,
  action: { type: 'build' as const, cell: { x: 0, y: 0 } },
};
it('blocks double submissions while a command is pending', async () => {
  const client = await import('./client');
  client.connect();
  const first = client.send('action:submit', payload);
  expect(
    await client.send('action:submit', {
      ...payload,
      commandId: crypto.randomUUID(),
    }),
  ).toBe(false);
  expect(transport.sent).toHaveLength(1);
  transport.sent[0]!.callback(null, { ok: true });
  expect(await first).toBe(true);
  expect(client.useGame.getState().pending).toBeNull();
});
it('keeps exactly the original command when acknowledgement is lost', async () => {
  const client = await import('./client');
  client.connect();
  const first = client.send('action:submit', payload);
  transport.sent[0]!.callback(new Error('ack timeout'));
  expect(await first).toBe(false);
  expect(client.useGame.getState().uncertain).toBe(true);
  const retry = client.retryPending();
  await vi.waitFor(() => expect(transport.sent).toHaveLength(2));
  expect(transport.sent[1]!.payload).toEqual(payload);
  transport.sent[1]!.callback(null, { ok: true });
  await retry;
  expect(client.useGame.getState().pending).toBeNull();
});
it('does not replay create/join automatically after a lost response', async () => {
  const client = await import('./client');
  client.connect();
  const request = client.send('room:create', {
    displayName: 'Ada',
    preset: 'small',
  });
  transport.sent[0]!.callback(new Error('ack timeout'));
  await request;
  expect(client.useGame.getState().pending).toBeNull();
  expect(client.useGame.getState().connection).toBe('offline');
  await client.retryPending();
  expect(transport.sent).toHaveLength(1);
});
it('ignores late acknowledgements after disconnect and stops on seat replacement', async () => {
  const client = await import('./client');
  client.connect();
  const first = client.send('action:submit', payload);
  transport.listeners.get('disconnect')?.('io server disconnect');
  transport.sent[0]!.callback(null, { ok: true });
  expect(await first).toBe(false);
  expect(client.useGame.getState().connection).toBe('replaced');
  expect(client.useGame.getState().pending?.payload).toEqual(payload);
  expect(client.useGame.getState().uncertain).toBe(true);
});
