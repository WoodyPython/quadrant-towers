import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const migrationsFolder = fileURLToPath(
  new URL('../../../../drizzle/', import.meta.url),
);

export function createDatabase(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 2000,
    query_timeout: 3000,
    max: 5,
  });
  // Idle connection failures must not terminate the process or expose credentials.
  pool.on('error', () => {});
  const db = drizzle(pool);
  const expected = readMigrationFiles({ migrationsFolder });
  return {
    pool,
    migrate: () => migrate(db, { migrationsFolder }),
    async ready() {
      try {
        const applied = await pool.query<{ hash: string }>(
          'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at',
        );
        if (
          applied.rows.length !== expected.length ||
          expected.some((entry, i) => applied.rows[i]?.hash !== entry.hash)
        )
          return false;
        const metadata = await pool.query<{ value: string }>(
          "SELECT value FROM application_metadata WHERE key = 'foundation_version'",
        );
        return metadata.rows[0]?.value === '1';
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
