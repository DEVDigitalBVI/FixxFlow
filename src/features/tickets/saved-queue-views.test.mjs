import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const { queueViewQuery } = load('src/features/tickets/queue-views.ts');

test('saved views keep only known queue filters, in a stable order', () => {
  assert.equal(
    queueViewQuery({
      tag: 'vpn',
      view: 'mine',
      page: '4',
      ticket: 'abc',
      success: 'Saved',
      evil: '<script>',
      priority: 'critical',
    }),
    'view=mine&priority=critical&tag=vpn',
  );
  assert.equal(
    queueViewQuery(new URLSearchParams('q=%20printer%20&sort=sla')),
    'q=printer&sort=sla',
  );
  assert.equal(
    queueViewQuery({ q: 'x'.repeat(201), status: 'open\u0000' }),
    '',
    'oversized or control characters are dropped',
  );
});

test('saved queue views are private to their owner, staff-only, capped and isolated', async () => {
  const db = await migratedPostgres();
  const [orgA, orgB] = [randomUUID(), randomUUID()];
  const u = {
    owner: randomUUID(),
    peer: randomUUID(),
    employee: randomUUID(),
    foreign: randomUUID(),
  };
  const as = async (user) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal1' }),
    ]);
    await db.exec('set role authenticated');
  };
  const attempt = async (sql, params = []) => {
    await db.exec('savepoint attempt');
    try {
      const result = await db.query(sql, params);
      await db.exec('release savepoint attempt');
      return { rows: result.rows, changed: result.affectedRows ?? 0 };
    } catch (error) {
      await db.exec('rollback to savepoint attempt');
      return { code: error.code, message: error.message };
    }
  };
  const save = (org, user, name) =>
    attempt(
      "insert into public.saved_queue_views(organization_id,user_id,name,query) values($1,$2,$3,'view=mine')",
      [org, user, name],
    );
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Alpha','views-a'),($2,'Bravo','views-b')",
      [orgA, orgB],
    );
    for (const [user, org, role] of [
      [u.owner, orgA, 'technician'],
      [u.peer, orgA, 'administrator'],
      [u.employee, orgA, 'end_user'],
      [u.foreign, orgB, 'administrator'],
    ]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
        user,
        `${user}@example.test`,
      ]);
      await db.query(
        'insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',
        [org, user, role],
      );
    }
    await db.exec('begin');
    await as(u.owner);
    assert.equal((await save(orgA, u.owner, ' My queue ')).changed, 1);
    assert.equal(
      (await save(orgA, u.owner, 'my QUEUE')).code,
      '23505',
      'names are unique per person',
    );
    assert.equal(
      (await save(orgA, u.peer, 'Planted')).code,
      '42501',
      'views cannot be saved for others',
    );
    for (let i = 1; i < 20; i += 1) await save(orgA, u.owner, `View ${i}`);
    assert.match((await save(orgA, u.owner, 'One more')).message, /up to 20/);

    await as(u.peer);
    assert.equal(
      (await attempt('select id from public.saved_queue_views')).rows.length,
      0,
      'even an administrator cannot see another person’s views',
    );
    assert.equal((await attempt('delete from public.saved_queue_views')).changed, 0);
    await as(u.employee);
    assert.equal(
      (await save(orgA, u.employee, 'Mine')).code,
      '42501',
      'employees cannot save views',
    );
    await as(u.foreign);
    assert.equal((await attempt('select id from public.saved_queue_views')).rows.length, 0);

    await as(u.owner);
    assert.equal((await attempt('select name from public.saved_queue_views')).rows.length, 20);
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
