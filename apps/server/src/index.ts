import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { createDatabase } from './db/database.js';
import { parseEnvironment } from './env.js';
import { defaultRegistry } from '@quadrant/game-engine';
import { Store } from './multiplayer/store.js';

async function main() {
  const buildFile = new URL('../../../build-id.txt', import.meta.url);
  const environment = parseEnvironment({
    ...process.env,
    BUILD_ID:
      process.env.BUILD_ID ??
      process.env.RAILWAY_GIT_COMMIT_SHA ??
      (existsSync(buildFile)
        ? readFileSync(buildFile, 'utf8').trim()
        : 'local'),
  });
  const database = createDatabase(environment.DATABASE_URL);
  const app = await buildApp({
    environment,
    ready: database.ready,
    closeDatabase: database.close,
    store: new Store(database.pool, defaultRegistry),
    ...(environment.NODE_ENV === 'production' || environment.SERVE_STATIC
      ? {
          staticRoot: fileURLToPath(
            new URL('../../web/dist/', import.meta.url),
          ),
        }
      : {}),
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 10000).unref();
    try {
      await app.close();
    } finally {
      clearTimeout(deadline);
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  try {
    await app.listen({ host: environment.HOST, port: environment.PORT });
  } catch {
    await app.close();
    throw new Error('Server could not listen. Check HOST and PORT.');
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error && error.message.startsWith('Invalid environment')
      ? error.message
      : 'Server startup failed. Check configuration and build artifacts.',
  );
  process.exitCode = 1;
});
