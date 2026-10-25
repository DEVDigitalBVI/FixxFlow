import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('reply email snapshots the exact public reply, excludes notes, and preserves retries', async () => {
  const db = await migratedPostgres();
  try {
    const org = randomUUID(),
      admin = randomUUID(),
      employee = randomUUID(),
      ticket = randomUUID(),
      message = randomUUID();
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Replies','reply-context')",
      [org],
    );
    for (const [id, role, name] of [
      [admin, 'administrator', 'Alex Support'],
      [employee, 'end_user', 'Taylor Requester'],
    ]) {
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
        id,
        `${id}@example.test`,
      ]);
      await db.query(
        'insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,$3)',
        [org, id, role],
      );
      await db.query(
        'insert into public.profiles(organization_id,user_id,display_name) values($1,$2,$3) on conflict(organization_id,user_id) do update set display_name=excluded.display_name',
        [org, id, name],
      );
    }
    await db.query(
      "insert into public.tickets(id,organization_id,requester_id,title,description,priority) values($1,$2,$3,'Printer issue','PRIVATE DESCRIPTION','high')",
      [ticket, org, employee],
    );
    const publicBody = 'Your printer is ready.\n' + 'a'.repeat(400);
    await db.query(
      'insert into public.ticket_messages(id,organization_id,ticket_id,author_id,body) values($1,$2,$3,$4,$5)',
      [message, org, ticket, admin, publicBody],
    );
    await db.query(
      "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'internal_note','PRIVATE INTERNAL NOTE')",
      [org, ticket, admin],
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int count from public.notifications where ticket_id=$1 and kind='ticket_response'",
          [ticket],
        )
      ).rows[0].count,
      1,
    );
    await db.query("update public.ticket_messages set body='Edited public reply' where id=$1", [
      message,
    ]);
    await db.query("update public.tickets set priority='low' where id=$1", [ticket]);
    await db.query(
      "update public.profiles set display_name='Renamed author' where organization_id=$1 and user_id=$2",
      [org, admin],
    );
    await db.exec('update private.notification_email_outbox set available_at=now()');
    const batch = (await db.query('select * from public.claim_notification_emails(20)')).rows;
    const mail = batch.find((n) => n.email_kind === 'ticket_response');
    assert.equal(mail.reply_author, 'Alex Support');
    assert.equal(mail.reply_preview, publicBody.slice(0, 320) + '…');
    assert.equal(mail.ticket_priority, 'high');
    assert.ok(mail.reply_created_at);
    assert.ok(!JSON.stringify(mail).includes('PRIVATE'));
    assert.ok(
      batch
        .filter((n) => n.email_kind === 'ticket_created')
        .every((n) => n.reply_preview === null && n.ticket_priority === 'high'),
    );
    await db.query('select public.finish_notification_email($1,$2,null,$3)', [
      mail.notification_id,
      mail.lease_token,
      'Retry',
    ]);
    await db.exec('update private.notification_email_outbox set available_at=now()');
    const retry = (await db.query('select * from public.claim_notification_emails(20)')).rows.find(
      (n) => n.notification_id === mail.notification_id,
    );
    for (const key of [
      'reply_author',
      'reply_preview',
      'ticket_status',
      'ticket_priority',
      'title',
    ])
      assert.equal(retry[key], mail[key], key);
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated','public.claim_notification_emails(integer)','execute') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});
