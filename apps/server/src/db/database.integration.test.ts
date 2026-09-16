import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it } from 'vitest';
import { createDatabase } from './database.js';
import { parseEnvironment } from '../env.js';
import { readFile } from 'node:fs/promises';

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

it('backfills retention timestamps and receipt associations without resetting age', async () => {
  const url = new URL(parseEnvironment(process.env).DATABASE_URL);
  const admin = new pg.Pool({ connectionString: url.href });
  const name = `quadrant_test_${randomUUID().replaceAll('-', '')}`;
  let pool: pg.Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.href });
    for (const migration of ['0000_broken_malice', '0001_closed_prism'])
      await pool.query(
        await readFile(
          new URL(`../../../../drizzle/${migration}.sql`, import.meta.url),
          'utf8',
        ),
      );
    const room = randomUUID(),
      player = randomUUID(),
      match = randomUUID();
    await pool.query(
      "INSERT INTO rooms VALUES ($1,'ABCDEF','small','finished',$2,$3,100)",
      [room, player, match],
    );
    await pool.query(
      "INSERT INTO players VALUES ($1,$2,'Test',0,'hash',100,200,NULL)",
      [player, room],
    );
    await pool.query(
      "INSERT INTO matches VALUES ($1,$2,'finished','small',1,1,'framework-1','framework-1',300,'{}')",
      [match, room],
    );
    await pool.query("INSERT INTO match_snapshots VALUES ($1,1,1,'{}',250)", [
      match,
    ]);
    await pool.query(
      "INSERT INTO match_commands VALUES ($1,1,$2,'command','{}',250)",
      [match, player],
    );
    await pool.query('INSERT INTO command_receipts VALUES ($1,$2,$3,$4,$5)', [
      room,
      player,
      randomUUID(),
      'fingerprint',
      { ok: true, matchId: match },
    ]);
    await pool.query(
      await readFile(
        new URL('../../../../drizzle/0002_calm_colossus.sql', import.meta.url),
        'utf8',
      ),
    );
    expect(
      (await pool.query('SELECT inactive_since FROM rooms')).rows[0]
        .inactive_since,
    ).toBe('200');
    expect(
      (await pool.query('SELECT finished_at FROM matches')).rows[0].finished_at,
    ).toBe('250');
    expect(
      (await pool.query('SELECT match_id FROM command_receipts')).rows[0]
        .match_id,
    ).toBe(match);
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
