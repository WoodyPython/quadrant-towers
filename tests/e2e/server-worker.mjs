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
const app = await buildApp({
  environment,
  ready: database.ready,
  closeDatabase: database.close,
  store: new Store(database.pool, defaultRegistry),
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
  if (message === 'timeout') {
    offset += 91_000;
    process.send({ advanced: true });
  }
});
