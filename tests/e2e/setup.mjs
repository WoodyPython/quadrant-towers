import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../apps/server/dist/app.js';
import { createDatabase } from '../../apps/server/dist/db/database.js';
import { parseEnvironment } from '../../apps/server/dist/env.js';
import { Store } from '../../apps/server/dist/multiplayer/store.js';
import { defaultRegistry } from '../../packages/game-engine/dist/index.js';
const require = createRequire(
  new URL('../../apps/server/package.json', import.meta.url),
);
const pg = require('pg');

export default async function setup() {
  const url = new URL(parseEnvironment(process.env).DATABASE_URL);
  const admin = new pg.Pool({ connectionString: url.href });
  const name = `quadrant_browser_${randomUUID().replaceAll('-', '')}`;
  let database;
  let app;
  const cleanup = async () => {
    await app?.close();
    if (!app) await database?.close();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  };
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    database = createDatabase(url.href);
    await database.migrate();
    app = await buildApp({
      environment: parseEnvironment({
        DATABASE_URL: url.href,
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn',
        ALLOWED_ORIGINS: 'http://127.0.0.1:3100',
      }),
      ready: database.ready,
      closeDatabase: database.close,
      store: new Store(database.pool, defaultRegistry),
      staticRoot: fileURLToPath(
        new URL('../../apps/web/dist/', import.meta.url),
      ),
    });
    await app.listen({ host: '127.0.0.1', port: 3100 });
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
