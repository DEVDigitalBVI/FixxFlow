import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('location hierarchy migration enforces paths, boundaries and descendant-aware reporting', async () => {
  const database = await migratedPostgres();
  try {
    const results = await database.exec(
      await readFile('supabase/tests/database/location_hierarchy.test.sql', 'utf8'),
    );
    const tap = results.flatMap((result) => result.rows).flatMap((row) => Object.values(row));
    assert.ok(
      tap.some((line) => String(line).startsWith('ok 27 ')),
      JSON.stringify(tap),
    );
    assert.ok(!tap.some((line) => String(line).startsWith('not ok')), JSON.stringify(tap));
  } finally {
    await database.close();
  }
});
