import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('ticket links are staff-only and duplicates close atomically within one workspace', async () => {
  const db = await migratedPostgres();
  const [orgA, orgB] = [randomUUID(), randomUUID()];
  const u = { tech: randomUUID(), requester: randomUUID(), foreign: randomUUID() };
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
  const ticket = async (title) =>
    (
      await db.query(
        "insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,$3,'Details') returning id, ticket_number, revision",
        [orgA, u.requester, title],
      )
    ).rows[0];
  const markDuplicate = (org, duplicate, main, revision, message = null) =>
    attempt('select public.mark_ticket_duplicate($1,$2,$3,$4,$5) as revision', [
      org,
      duplicate,
      main,
      revision,
      message,
    ]);
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Alpha','links-a'),($2,'Bravo','links-b')",
      [orgA, orgB],
    );
    for (const [user, org, role] of [
      [u.tech, orgA, 'technician'],
      [u.requester, orgA, 'end_user'],
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
    const main = await ticket('Email is down');
    const dup = await ticket('Cannot send email');
    const other = await ticket('Printer offline');
    await db.exec('begin');

    await as(u.tech);
    const relate = (a, b) =>
      attempt(
        "insert into public.ticket_links(organization_id,ticket_id,linked_ticket_id,kind,created_by) values($1,$2,$3,'related',$4)",
        [orgA, a, b, u.tech],
      );
    assert.equal((await relate(main.id, dup.id)).changed, 1);
    assert.equal(
      (await relate(dup.id, main.id)).code,
      '23505',
      'a pair is linked once, in either direction',
    );
    assert.equal(
      (
        await attempt(
          "insert into public.ticket_links(organization_id,ticket_id,linked_ticket_id,kind,created_by) values($1,$2,$3,'duplicate',$4)",
          [orgA, other.id, main.id, u.tech],
        )
      ).code,
      '42501',
      'duplicate links only come from mark_ticket_duplicate',
    );

    await as(u.requester);
    assert.equal((await attempt('select * from public.ticket_links')).rows.length, 0);
    assert.equal(
      (await markDuplicate(orgA, dup.id, main.id, dup.revision)).code,
      '42501',
      'employees cannot close duplicates',
    );
    await as(u.foreign);
    assert.equal(
      (await markDuplicate(orgA, dup.id, main.id, dup.revision)).code,
      '42501',
      'another organization cannot close this workspace’s tickets',
    );

    await as(u.tech);
    assert.equal((await markDuplicate(orgA, dup.id, dup.id, dup.revision)).code, '22023');
    assert.equal(
      (await markDuplicate(orgA, dup.id, main.id, dup.revision + 5)).code,
      'PT409',
      'a stale view cannot close the ticket',
    );
    const closed = await markDuplicate(
      orgA,
      dup.id,
      main.id,
      dup.revision,
      'We are handling this together with a related request.',
    );
    assert.ok(closed.rows[0].revision > dup.revision, closed.message);
    await db.exec('reset role');
    assert.equal(
      (await db.query('select status from public.tickets where id=$1', [dup.id])).rows[0].status,
      'closed',
    );
    assert.deepEqual(
      (
        await db.query(
          'select kind from public.ticket_links where ticket_id=$1 and linked_ticket_id=$2',
          [dup.id, main.id],
        )
      ).rows,
      [{ kind: 'duplicate' }],
      'the related link became a duplicate link',
    );
    const notes = (
      await db.query(
        'select ticket_id, kind, body from public.ticket_messages where ticket_id = any($1) order by created_at, kind',
        [[dup.id, main.id]],
      )
    ).rows;
    assert.ok(
      notes.some(
        (m) =>
          m.ticket_id === dup.id &&
          m.kind === 'internal_note' &&
          m.body === `Closed as a duplicate of ticket #${main.ticket_number}.`,
      ),
    );
    assert.ok(
      notes.some(
        (m) =>
          m.ticket_id === main.id &&
          m.kind === 'internal_note' &&
          m.body.includes(`#${dup.ticket_number}`),
      ),
    );
    assert.ok(notes.some((m) => m.ticket_id === dup.id && m.kind === 'reply'));

    await as(u.tech);
    assert.match(
      (await markDuplicate(orgA, other.id, dup.id, other.revision)).message,
      /itself a duplicate/,
      'duplicates cannot chain',
    );

    await as(u.requester);
    const seen = (
      await db.query('select kind from public.ticket_messages where ticket_id=$1', [dup.id])
    ).rows.map((m) => m.kind);
    assert.deepEqual(seen, ['reply'], 'the requester sees the public reply, not internal notes');

    await db.exec('reset role');
    assert.ok(
      (
        await db.query(
          "select count(*)::int as n from public.audit_events where entity_type='ticket_links'",
        )
      ).rows[0].n >= 3,
      'links are audited',
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
