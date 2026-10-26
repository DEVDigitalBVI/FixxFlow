import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('ticket tags are staff-only (even for the requester), normalized, capped, audited and isolated', async () => {
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
  const addTag = (org, ticket, tag, user) =>
    attempt(
      'insert into public.ticket_tags(organization_id,ticket_id,tag,created_by) values($1,$2,$3,$4) returning tag',
      [org, ticket, tag, user],
    );
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Alpha','tags-a'),($2,'Bravo','tags-b')",
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
    const ticket = (
      await db.query(
        "insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,'VPN drops','Details') returning id",
        [orgA, u.requester],
      )
    ).rows[0].id;
    await db.exec('begin');

    await as(u.tech);
    assert.equal((await addTag(orgA, ticket, '  VPN   Issue ', u.tech)).rows[0].tag, 'vpn issue');
    assert.equal(
      (await addTag(orgA, ticket, 'vpn issue', u.tech)).code,
      '23505',
      'duplicates are rejected',
    );
    assert.equal(
      (await addTag(orgA, ticket, '<script>', u.tech)).code,
      '23514',
      'invalid characters are rejected',
    );
    assert.equal(
      (await addTag(orgA, ticket, 'forged', u.requester)).code,
      '42501',
      'tags cannot be added in someone else’s name',
    );
    for (let i = 1; i < 10; i += 1) await addTag(orgA, ticket, `tag ${i}`, u.tech);
    assert.match(
      (await addTag(orgA, ticket, 'one too many', u.tech)).message,
      /up to 10 tags/,
      'a ticket holds at most 10 tags',
    );

    await as(u.requester);
    assert.equal(
      (await attempt('select tag from public.ticket_tags where ticket_id=$1', [ticket])).rows
        .length,
      0,
      'the requester cannot see internal tags on their own ticket',
    );
    assert.equal((await addTag(orgA, ticket, 'mine', u.requester)).code, '42501');

    await as(u.foreign);
    assert.equal((await attempt('select tag from public.ticket_tags')).rows.length, 0);
    assert.equal(
      (await addTag(orgA, ticket, 'planted', u.foreign)).code,
      '42501',
      'another organization cannot tag this ticket',
    );

    await as(u.tech);
    assert.equal(
      (
        await attempt('delete from public.ticket_tags where ticket_id=$1 and tag=$2', [
          ticket,
          'vpn issue',
        ])
      ).changed,
      1,
    );

    await db.exec('reset role');
    const audit = (
      await db.query(
        "select action, entity_label, changes from public.audit_events where entity_type='ticket_tags' and entity_id=$1 order by id",
        [ticket],
      )
    ).rows;
    assert.equal(audit[0].action, 'created');
    assert.match(audit[0].entity_label, /^Ticket #\d+$/);
    assert.deepEqual(audit[0].changes, [{ field: 'tag', from: null, to: 'vpn issue' }]);
    assert.equal(audit.at(-1).action, 'deleted');
    assert.deepEqual(audit.at(-1).changes, [{ field: 'tag', from: 'vpn issue', to: null }]);
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
