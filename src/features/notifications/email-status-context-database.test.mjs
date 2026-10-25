import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('outcome emails capture the exact transition, actor, owner and priority across retries', async () => {
  const db = await migratedPostgres();
  try {
    const org = randomUUID(),
      worker = randomUUID(),
      employee = randomUUID(),
      ticket = randomUUID();
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Outcomes','outcome-mail')",
      [org],
    );
    for (const [id, role, name] of [
      [worker, 'administrator', 'Alex Support'],
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
        'insert into public.profiles(organization_id,user_id,display_name) values($1,$2,$3)',
        [org, id, name],
      );
    }
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: worker }),
    ]);
    await db.query(
      "insert into public.tickets(id,organization_id,requester_id,assigned_technician_id,title,description,status,priority) values($1,$2,$3,$4,'Printer','PRIVATE BODY','in_progress','high')",
      [ticket, org, employee, worker],
    );
    await db.query("update public.tickets set status='resolved' where id=$1", [ticket]);
    await db.exec('update private.notification_email_outbox set available_at=now()');
    const mail = (await db.query('select * from public.claim_notification_emails(20)')).rows.find(
      (n) => n.email_kind === 'ticket_resolved',
    );
    assert.equal(mail.previous_status, 'in_progress');
    assert.equal(mail.ticket_status, 'resolved');
    assert.equal(mail.status_changed_by, 'Alex Support');
    assert.equal(mail.ticket_owner, 'Alex Support');
    assert.equal(mail.ticket_priority, 'high');
    assert.ok(mail.event_created_at);
    assert.ok(!JSON.stringify(mail).includes('PRIVATE BODY'));
    await db.query('select public.finish_notification_email($1,$2,null,$3)', [
      mail.notification_id,
      mail.lease_token,
      'Retry',
    ]);
    await db.query(
      "update public.profiles set display_name='Renamed' where organization_id=$1 and user_id=$2",
      [org, worker],
    );
    await db.query("update public.tickets set status='open',priority='low' where id=$1", [ticket]);
    await db.exec('update private.notification_email_outbox set available_at=now()');
    const next = (await db.query('select * from public.claim_notification_emails(20)')).rows;
    const retry = next.find((n) => n.notification_id === mail.notification_id);
    for (const key of [
      'previous_status',
      'ticket_status',
      'status_changed_by',
      'ticket_owner',
      'ticket_priority',
      'title',
    ])
      assert.equal(retry[key], mail[key]);
    const reopened = next.find((n) => n.email_kind === 'ticket_reopened');
    assert.equal(reopened.previous_status, 'resolved');
    assert.equal(reopened.ticket_status, 'open');
    assert.equal(reopened.ticket_priority, 'low');
  } finally {
    await db.close();
  }
});
