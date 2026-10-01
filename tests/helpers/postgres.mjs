import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

/** Disposable real PostgreSQL, with only Supabase-owned schemas stubbed.
 * Application migrations are replayed verbatim. This does not emulate HTTP,
 * JWT verification, Storage services, Realtime delivery, or multiple sessions.
 */
export async function migratedPostgres() {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await db.exec(await readFile('tests/fixtures/supabase-bootstrap.sql', 'utf8'));
    const migrations = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
    for (const migration of migrations) {
      try { await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8')); }
      catch (error) { throw new Error(`Migration ${migration}: ${error.message}`, { cause: error }); }
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}
