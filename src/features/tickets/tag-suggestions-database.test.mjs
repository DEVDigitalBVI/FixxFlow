import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  employee = '10000000-0000-0000-0000-000000000404',
  outsider = '10000000-0000-0000-0000-000000000402';
async function identity(db, id) {
  await db.exec('reset role');
  await db.query('select pg_temp.set_test_session($1,false)', [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
test('tag aggregation is deterministic, bounded, staff-only and tenant-isolated', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await identity(db, admin);
    for (let n = 0; n < 7; n++) {
      const ticket = (
        await db.query(
          "insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,'Tags','Help') returning id",
          [org, employee],
        )
      ).rows[0].id;
      for (let tag = 0; tag < 9; tag++)
        await db.query(
          'insert into public.ticket_tags(organization_id,ticket_id,tag,created_by) values($1,$2,$3,$4)',
          [org, ticket, `tag ${String(n * 9 + tag).padStart(2, '0')}`, admin],
        );
      if (n < 2)
        await db.query(
          "insert into public.ticket_tags(organization_id,ticket_id,tag,created_by) values($1,$2,'common',$3)",
          [org, ticket, admin],
        );
    }
    const rows = (
      await db.query('select * from public.ticket_tag_suggestions($1)', [org])
    ).rows.map((row) => row.tag);
    assert.equal(rows.length, 50);
    assert.equal(rows[0], 'common');
    assert.equal(rows[1], 'tag 00');
    assert.equal(rows[49], 'tag 48');
    for (const user of [employee, outsider]) {
      await identity(db, user);
      await assert.rejects(
        db.query('select * from public.ticket_tag_suggestions($1)', [org]),
        (e) => e.code === '42501',
      );
    }
    await db.exec('reset role; set role anon');
    await assert.rejects(
      db.query('select * from public.ticket_tag_suggestions($1)', [org]),
      (e) => e.code === '42501',
    );
  } finally {
    await db.close();
  }
});
