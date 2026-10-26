import { readdir, readFile } from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';
import { pgtap } from '@electric-sql/pglite-pgtap';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

/** Disposable real PostgreSQL, with only Supabase-owned schemas stubbed.
 * Application migrations are replayed verbatim. This does not emulate HTTP,
 * JWT verification, Storage services, Realtime delivery, or multiple sessions.
 */
export async function migratedPostgres({ beforeMigration, throughMigration } = {}) {
  const db = new PGlite({ extensions: { pg_trgm, pgtap } });
  try {
    await db.exec(await readFile('tests/fixtures/supabase-bootstrap.sql', 'utf8'));
    const migrations = (await readdir('supabase/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    if (throughMigration && !migrations.includes(throughMigration)) {
      throw new Error(`Unknown migration: ${throughMigration}`);
    }
    for (const migration of migrations) {
      await beforeMigration?.(db, migration);
      try {
        await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
      } catch (error) {
        throw new Error(`Migration ${migration}: ${error.message}`, { cause: error });
      }
      if (migration === throughMigration) break;
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
