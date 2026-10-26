import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('saved replies are staff-only, author- or admin-managed, audited and tenant-isolated', async () => {
  const db = await migratedPostgres();
  const [orgA, orgB] = [randomUUID(), randomUUID()];
  const u = {
    author: randomUUID(),
    peer: randomUUID(),
    admin: randomUUID(),
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
  // Runs a statement and reports its outcome without leaving an aborted transaction.
  const attempt = async (sql, params = []) => {
    await db.exec('savepoint attempt');
    try {
      const result = await db.query(sql, params);
      await db.exec('release savepoint attempt');
      return { rows: result.rows, changed: result.affectedRows ?? 0 };
    } catch (error) {
      await db.exec('rollback to savepoint attempt');
      return { code: error.code };
    }
  };
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Alpha','replies-a'),($2,'Bravo','replies-b')",
      [orgA, orgB],
    );
    for (const [user, org, role] of [
      [u.author, orgA, 'technician'],
      [u.peer, orgA, 'technician'],
      [u.admin, orgA, 'administrator'],
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

    await as(u.author);
    const created = await attempt(
      "insert into public.saved_replies(organization_id,title,body,created_by) values($1,'  Password reset  ','Hi {{requester_first_name}}, try this.',$2) returning id,title,revision",
      [orgA, u.author],
    );
    assert.equal(created.rows[0].title, 'Password reset', 'title is trimmed');
    assert.equal(created.rows[0].revision, 1);
    const replyId = created.rows[0].id;
    assert.equal(
      (
        await attempt(
          "insert into public.saved_replies(organization_id,title,body,created_by) values($1,'Forged','x',$2)",
          [orgA, u.peer],
        )
      ).code,
      '42501',
      'staff cannot create a reply in someone else’s name',
    );
    assert.equal(
      (
        await attempt(
          "insert into public.saved_replies(organization_id,title,body,created_by) values($1,'PASSWORD RESET','x',$2)",
          [orgA, u.author],
        )
      ).code,
      '23505',
      'titles are unique per workspace, ignoring case',
    );

    await as(u.peer);
    assert.equal(
      (await attempt('select id from public.saved_replies where id=$1', [replyId])).rows.length,
      1,
      'every technician in the workspace can use the reply',
    );
    assert.equal(
      (await attempt("update public.saved_replies set body='changed' where id=$1", [replyId]))
        .changed,
      0,
      'another technician cannot edit it',
    );
    assert.equal(
      (await attempt('delete from public.saved_replies where id=$1', [replyId])).changed,
      0,
      'another technician cannot delete it',
    );

    await as(u.employee);
    assert.equal((await attempt('select id from public.saved_replies')).rows.length, 0);
    assert.equal(
      (
        await attempt(
          "insert into public.saved_replies(organization_id,title,body,created_by) values($1,'Employee','x',$2)",
          [orgA, u.employee],
        )
      ).code,
      '42501',
      'employees cannot create saved replies',
    );

    await as(u.foreign);
    assert.equal(
      (await attempt('select id from public.saved_replies')).rows.length,
      0,
      'another organization cannot see the reply',
    );
    assert.equal(
      (
        await attempt(
          "insert into public.saved_replies(organization_id,title,body,created_by) values($1,'Planted','x',$2)",
          [orgA, u.foreign],
        )
      ).code,
      '42501',
      'another organization cannot add replies to this workspace',
    );

    await as(u.admin);
    const edited = await attempt(
      "update public.saved_replies set body='Updated steps' where id=$1 returning revision",
      [replyId],
    );
    assert.equal(
      edited.rows[0].revision,
      2,
      'administrators can edit any reply; revision advances',
    );
    assert.equal(
      (
        await attempt('update public.saved_replies set created_by=$2 where id=$1', [
          replyId,
          u.admin,
        ])
      ).code,
      '42501',
      'authorship cannot be reassigned',
    );

    await db.exec('reset role');
    const audit = (
      await db.query(
        "select action, entity_label, changes from public.audit_events where entity_type='saved_replies' and entity_id=$1 order by created_at, id",
        [replyId],
      )
    ).rows;
    assert.deepEqual(
      audit.map((event) => event.action),
      ['created', 'updated'],
    );
    assert.equal(audit[0].entity_label, 'Password reset');
    assert.doesNotMatch(
      JSON.stringify(audit),
      /try this|Updated steps/,
      'reply text never enters the audit log',
    );

    await as(u.admin);
    assert.equal(
      (await attempt('delete from public.saved_replies where id=$1', [replyId])).changed,
      1,
      'administrators can delete any reply',
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
