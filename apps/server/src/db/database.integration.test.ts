import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it } from 'vitest';
import { createDatabase } from './database.js';
import { parseEnvironment } from '../env.js';

it('migrates an isolated empty database, is repeatable, and detects drift', async () => {
  const url = new URL(parseEnvironment(process.env).DATABASE_URL);
  const admin = new pg.Pool({ connectionString: url.href });
  const name = `quadrant_test_${randomUUID().replaceAll('-', '')}`;
  let database: ReturnType<typeof createDatabase> | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    database = createDatabase(url.href);
    expect(await database.ready()).toBe(false);
    await database.migrate();
    expect(await database.ready()).toBe(true);
    const before = await database.pool.query(
      'SELECT * FROM drizzle.__drizzle_migrations',
    );
    await database.migrate();
    expect(
      (await database.pool.query('SELECT * FROM drizzle.__drizzle_migrations'))
        .rows,
    ).toEqual(before.rows);
    expect(
      (await database.pool.query('SELECT * FROM application_metadata')).rows,
    ).toEqual([{ key: 'foundation_version', value: '1' }]);
    await database.pool.query(
      "UPDATE drizzle.__drizzle_migrations SET hash = 'changed'",
    );
    expect(await database.ready()).toBe(false);
  } finally {
    await database?.close();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
