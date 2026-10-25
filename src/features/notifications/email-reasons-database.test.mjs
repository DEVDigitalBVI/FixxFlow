import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('email reasons follow the stored event while attempted payloads keep legacy wording', async () => {
  const org = randomUUID(),
    admin = randomUUID();
  let attempted;
  const db = await migratedPostgres({
    beforeMigration: async (db, name) => {
      if (!name.endsWith('_notification_email_reasons.sql')) return;
      await db.query(
        "insert into public.organizations(id,name,slug) values($1,'Reasons','mail-reasons')",
        [org],
      );
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,'reasons@example.test',now())",
        [admin],
      );
      await db.query(
        "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'administrator')",
        [org, admin],
      );
      await db.query(
        "insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,'Before rollout','Private body')",
        [org, admin],
      );
      attempted = (await db.query('select * from public.claim_notification_emails(20)')).rows[0];
      await db.query('select public.finish_notification_email($1,$2,null,$3)', [
        attempted.notification_id,
        attempted.lease_token,
        'Retry',
      ]);
    },
  });
  try {
    const ticket = randomUUID();
    await db.query(
      "insert into public.tickets(id,organization_id,requester_id,title,description) values($1,$2,$3,'New work','Private body')",
      [ticket, org, admin],
    );
    await db.query('update public.tickets set assigned_technician_id=$1 where id=$2', [
      admin,
      ticket,
    ]);
    await db.exec('update private.notification_email_outbox set available_at=now()');
    const batch = (await db.query('select * from public.claim_notification_emails(20)')).rows;
    assert.equal(
      batch.find((n) => n.notification_id === attempted.notification_id).email_kind,
      null,
    );
    assert.deepEqual(
      batch
        .filter((n) => n.ticket_id === ticket)
        .map((n) => n.email_kind)
        .sort(),
      ['ticket_assigned', 'ticket_created'],
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
