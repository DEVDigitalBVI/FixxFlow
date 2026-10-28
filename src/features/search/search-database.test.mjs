import assert from 'node:assert/strict';
import test from 'node:test';

import { identity, ids, seed, ticket } from '../../../tests/helpers/automation-worker.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

// Replays the RPC projection/order structure captured from production PostgREST
// 14.5 logs. PostgreSQL itself resolves the columns; this is not an HTTP server.
test('workspace ticket search executes the projected, sorted RPC query in PostgreSQL', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    const own = await ticket(db);
    await ticket(db, ids.otherOrg);
    await identity(db);

    const query = (fields) => `with pgrst_source as (
      select ${[...new Set([...fields.split(','), 'organization_id'])].map((field) => `pgrst_call.${field}`).join(',')}
      from public.search_tickets($1,$2) pgrst_call
    ) select ${fields} from pgrst_source as tickets
      where tickets.organization_id=$1
      order by tickets.updated_at desc,tickets.id asc limit 8`;

    await db.exec('savepoint missing_sort_column');
    await assert.rejects(
      db.query(query('id,ticket_number,title'), [ids.org, 'Worker']),
      (error) => error.code === '42703' && /tickets.updated_at/.test(error.message),
    );
    await db.exec(
      'rollback to savepoint missing_sort_column; release savepoint missing_sort_column',
    );

    const client = {
      rpc: async (name, args) => ({
        data: (
          await db.query('select * from public.search_workspace($1,$2)', [
            args.org,
            args.search_text,
          ])
        ).rows,
        error: null,
      }),
    };
    const { searchWorkspace } = load('src/features/search/service.ts', {
      '@/lib/auth/viewer': {
        requireViewer: async () => ({
          role: 'administrator',
          id: ids.admin,
          organizationId: ids.org,
        }),
      },
      '@/lib/supabase/server': { createClient: async () => client },
    });
    const results = await searchWorkspace('Worker');
    assert.equal(
      results.filter((r) => r.group === 'Tickets').length,
      1,
      'Other-organization tickets stay excluded',
    );
    assert.equal(results.find((r) => r.group === 'Tickets').id, own.id);

    assert.equal(
      'updated_at' in results[0],
      false,
      'The sort field is not exposed in the search response',
    );
  } finally {
    await db.close();
  }
});
