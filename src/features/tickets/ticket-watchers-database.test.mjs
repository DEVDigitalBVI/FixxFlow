import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('staff watch tickets for themselves and are notified once of replies and resolution', async () => {
  const db = await migratedPostgres();
  const [orgA, orgB] = [randomUUID(), randomUUID()];
  const u = {
    watcher: randomUUID(),
    assignee: randomUUID(),
    admin: randomUUID(),
    requester: randomUUID(),
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
      return { code: error.code };
    }
  };
  const notificationsFor = async (user, ticketId) => {
    await db.exec('reset role');
    return (
      await db.query(
        'select kind, title, event_key from public.notifications where recipient_id=$1 and ticket_id=$2 order by created_at, id',
        [user, ticketId],
      )
    ).rows;
  };
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Alpha','watch-a'),($2,'Bravo','watch-b')",
      [orgA, orgB],
    );
    for (const [user, org, role] of [
      [u.watcher, orgA, 'technician'],
      [u.assignee, orgA, 'technician'],
      [u.admin, orgA, 'administrator'],
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
        "insert into public.tickets(organization_id,requester_id,assigned_technician_id,title,description) values($1,$2,$3,'Laptop slow','Details') returning id",
        [orgA, u.requester, u.assignee],
      )
    ).rows[0].id;
    await db.exec('begin');
    const watch = (user) =>
      attempt(
        'insert into public.ticket_watchers(organization_id,ticket_id,user_id) values($1,$2,$3)',
        [orgA, ticket, user],
      );

    await as(u.watcher);
    assert.equal((await watch(u.watcher)).changed, 1);
    assert.equal((await watch(u.admin)).code, '42501', 'staff cannot sign others up');
    await as(u.assignee);
    assert.equal((await watch(u.assignee)).changed, 1, 'the assignee may also watch');
    await as(u.requester);
    assert.equal((await watch(u.requester)).code, '42501', 'employees cannot watch tickets');
    assert.equal((await attempt('select * from public.ticket_watchers')).rows.length, 0);
    await as(u.foreign);
    assert.equal((await watch(u.foreign)).code, '42501');

    // Requester reply: the watcher is told; the assignee-watcher gets a single notification.
    await as(u.requester);
    await db.query(
      "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','Still slow')",
      [orgA, ticket, u.requester],
    );
    let watcherNotes = await notificationsFor(u.watcher, ticket);
    assert.deepEqual(
      watcherNotes.map((n) => n.kind),
      ['user_replied'],
    );
    assert.match(watcherNotes[0].title, /watched ticket/);
    assert.equal(
      (await notificationsFor(u.assignee, ticket)).filter((n) => n.kind === 'user_replied').length,
      1,
      'a watcher who is also the assignee is notified once',
    );

    // Internal notes notify no one.
    await as(u.assignee);
    await db.query(
      "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'internal_note','Checking disk')",
      [orgA, ticket, u.assignee],
    );
    assert.equal((await notificationsFor(u.watcher, ticket)).length, 1);

    // Resolution notifies the watcher with status details for the email.
    await as(u.assignee);
    await db.query("update public.tickets set status='resolved' where id=$1", [ticket]);
    watcherNotes = await notificationsFor(u.watcher, ticket);
    const resolved = watcherNotes.find((n) => n.kind === 'ticket_resolved');
    assert.ok(resolved, 'the watcher hears about resolution');
    const outbox = (
      await db.query(
        'select q.ticket_status, q.previous_status from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.recipient_id=$1 and n.event_key=$2',
        [u.watcher, resolved.event_key],
      )
    ).rows[0];
    assert.deepEqual(outbox, { ticket_status: 'resolved', previous_status: 'new' });

    // Only the watcher themself or an administrator can remove a watch.
    await as(u.assignee);
    assert.equal(
      (
        await attempt('delete from public.ticket_watchers where ticket_id=$1 and user_id=$2', [
          ticket,
          u.watcher,
        ])
      ).changed,
      0,
    );
    await as(u.admin);
    assert.equal(
      (
        await attempt('delete from public.ticket_watchers where ticket_id=$1 and user_id=$2', [
          ticket,
          u.watcher,
        ])
      ).changed,
      1,
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
