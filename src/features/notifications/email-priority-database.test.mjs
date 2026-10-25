import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const { sendNotificationEmail } = load('src/features/notifications/email.ts');

test('intake priority survives edits and retries and reaches every email format', async () => {
  const org = randomUUID(),
    admin = randomUUID();
  let attempted, unattempted;
  const db = await migratedPostgres({
    beforeMigration: async (db, name) => {
      if (!name.endsWith('_ticket_intake_email_priority.sql')) return;
      await db.query(
        "insert into public.organizations(id,name,slug) values($1,'Priority','priority-mail')",
        [org],
      );
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,'priority@example.test',now())",
        [admin],
      );
      await db.query(
        "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'administrator')",
        [org, admin],
      );
      await db.query(
        "insert into public.tickets(organization_id,requester_id,title,description,priority) values($1,$2,'Already attempted','Private body','high')",
        [org, admin],
      );
      attempted = (await db.query('select * from public.claim_notification_emails(20)')).rows[0];
      await db.query('select public.finish_notification_email($1,$2,null,$3)', [
        attempted.notification_id,
        attempted.lease_token,
        'Retry',
      ]);
      unattempted = randomUUID();
      await db.query(
        "insert into public.tickets(id,organization_id,requester_id,title,description,priority) values($1,$2,$3,'Not attempted','Private body','critical')",
        [unattempted, org, admin],
      );
    },
  });
  try {
    for (const priority of ['low', 'normal', 'high', 'critical']) {
      const ticket = randomUUID();
      await db.query(
        "insert into public.tickets(id,organization_id,requester_id,title,description,priority) values($1,$2,$3,'Priority test','Private body',$4)",
        [ticket, org, admin, priority],
      );
      await db.query(
        "update public.tickets set priority=case when priority='low' then 'critical'::public.ticket_priority else 'low'::public.ticket_priority end where id=$1",
        [ticket],
      );
      const claimed = (await db.query('select * from public.claim_notification_emails(20)')).rows;
      const mail = claimed.find((n) => n.ticket_id === ticket);
      const label = priority[0].toUpperCase() + priority.slice(1);
      assert.ok(mail.title.endsWith(`Priority: ${label}`));
      await sendNotificationEmail(
        mail,
        {
          apiKey: 'mock',
          from: 'FixxFlow <support@example.test>',
          siteUrl: 'https://example.test',
        },
        async (_url, options) => {
          const body = JSON.parse(options.body);
          for (const field of ['subject', 'text', 'html'])
            assert.ok(body[field].includes(`Priority: ${label}`), field);
          assert.ok(!body.html.includes('Private body'));
          return Response.json({ id: 'mock-delivery' });
        },
      );
      await db.query('select public.finish_notification_email($1,$2,null,$3)', [
        mail.notification_id,
        mail.lease_token,
        'Retry',
      ]);
    }
    await db.exec(
      "update private.notification_email_outbox set available_at=now(),lease_until=now()-interval '1 second' where status in ('pending','sending')",
    );
    const retry = (await db.query('select * from public.claim_notification_emails(20)')).rows;
    assert.equal(
      retry.find((n) => n.notification_id === attempted.notification_id).title,
      attempted.title,
      'attempted payload is unchanged by migration',
    );
    assert.ok(
      retry.find((n) => n.ticket_id === unattempted).title.endsWith('Priority: Critical'),
      'unattempted intake is backfilled',
    );
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
