import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(
  new URL('../apps/server/package.json', import.meta.url),
);
const { Pool } = require('pg');
const [operation, file] = process.argv.slice(2);
if (
  !['export', 'restore-drill'].includes(operation) ||
  !file ||
  !process.env.DATABASE_URL
)
  throw new Error(
    'Usage: node scripts/backup.mjs export|restore-drill <dump-file>; set DATABASE_URL',
  );
const url = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(url.protocol))
  throw new Error('PostgreSQL URL required');
const path = resolve(file);
function run(command, args, target) {
  // Keep credentials out of process arguments and diagnostics.
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      PGHOST: target.hostname,
      PGPORT: target.port || '5432',
      PGUSER: decodeURIComponent(target.username),
      PGPASSWORD: decodeURIComponent(target.password),
      PGDATABASE: decodeURIComponent(target.pathname.slice(1)),
      PGSSLMODE: target.searchParams.get('sslmode') ?? 'prefer',
    },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed; verify PostgreSQL client version, connectivity, and permissions`,
    );
}
if (operation === 'export') {
  if (existsSync(path))
    throw new Error('Refusing to overwrite an existing backup');
  process.umask(0o077);
  run(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-acl', '--file', path],
    url,
  );
  chmodSync(path, 0o600);
  console.log(
    'Logical backup created. Store it encrypted outside Railway and outside synced project folders.',
  );
} else {
  if (!existsSync(path)) throw new Error('Backup file not found');
  const name = `quadrant_restore_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url.href });
  const target = new URL(url);
  target.pathname = `/${name}`;
  const started = Date.now();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    run(
      'pg_restore',
      ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', name, path],
      target,
    );
    const { createDatabase } =
      await import('../apps/server/dist/db/database.js');
    const { Store } = await import('../apps/server/dist/multiplayer/store.js');
    const { defaultRegistry } =
      await import('../packages/game-engine/dist/index.js');
    const restored = createDatabase(target.href);
    try {
      if (!(await restored.ready()))
        throw new Error('Restored migration history does not match this build');
      const store = new Store(restored.pool, defaultRegistry);
      const ids = await store.ids();
      for (const id of ids) await store.read(id);
      console.log(
        `Restore verified: ${ids.length} rooms, ${Date.now() - started} ms. Disposable database: ${name}`,
      );
      console.log(
        'Use this isolated database for the seat-rejoin and match-completion rehearsal; drop it afterward.',
      );
    } finally {
      await restored.close();
    }
  } finally {
    await admin.end();
  }
}
