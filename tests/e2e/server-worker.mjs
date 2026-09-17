// Disposable browser-test server. IPC controls never exist in the deployed app.
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/server/dist/app.js';
import { createDatabase } from '../../apps/server/dist/db/database.js';
import { parseEnvironment } from '../../apps/server/dist/env.js';
import { Store } from '../../apps/server/dist/multiplayer/store.js';
import { defaultRegistry } from '../../packages/game-engine/dist/index.js';
const database = createDatabase(process.env.DATABASE_URL);
let offset = 0;
const environment = parseEnvironment({
  ...process.env,
  PORT: '3000',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  RATE_LIMITS: 'false',
});
const store = new Store(database.pool, defaultRegistry);
const app = await buildApp({
  environment,
  ready: database.ready,
  closeDatabase: database.close,
  store,
  staticRoot: fileURLToPath(new URL('../../apps/web/dist/', import.meta.url)),
  clock: {
    now: () => Date.now() + offset,
    schedule(callback, delay) {
      const timer = setTimeout(callback, delay).unref();
      return () => clearTimeout(timer);
    },
  },
});
const address = await app.listen({
  host: '127.0.0.1',
  port: Number(process.env.PORT ?? 0),
});
environment.ALLOWED_ORIGINS.push(address);
process.send({ address });
process.on('message', async (message) => {
  if (message === 'close') {
    await app.close();
    process.exit(0);
  }
  if (
    message &&
    typeof message === 'object' &&
    message.type === 'ability_fixture'
  ) {
    const roomId = await store.find(message.code);
    const saved = await store.transaction(roomId, async (aggregate) => {
      const state = aggregate.state;
      state.turn.cardOffer = message.cardIds;
      state.turn.selectedCardId = null;
      state.turn.actionsRemaining = 2;
      state.turn.freeAttacksAvailable = 0;
      state.turn.normalActionsTaken = 0;
      state.turn.round = message.round ?? state.turn.round;
      state.turn.deadline = Date.now() + offset + 90000;
      state.effects = [];
      state.version++;
      return { value: state.turn.playerId, write: {} };
    });
    process.send({ fixtureReady: true, actorId: saved.value });
  }
  if (message === 'timeout') {
    offset += 91_000;
    process.send({ advanced: true });
  }
});
