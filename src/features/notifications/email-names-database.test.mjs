import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('email name upgrade preserves attempted payloads and snapshots new names across retries', async () => {
  const org = randomUUID(),
    admin = randomUUID(),
    ticket = randomUUID();
  let attempted;
  const db = await migratedPostgres({
    beforeMigration: async (db, name) => {
      if (!name.endsWith('_ticket_email_names.sql')) return;
      await db.query(
        "insert into public.organizations(id,name,slug) values($1,'Names','email-name-upgrade')",
        [org],
      );
      await db.query(
        "insert into auth.users(id,email,email_confirmed_at) values($1,'name-test@example.test',now())",
        [admin],
      );
      await db.query(
        "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'administrator')",
        [org, admin],
      );
      await db.query(
        "insert into public.tickets(id,organization_id,requester_id,title,description) values($1,$2,$3,E'Printer\\n needs\\t help','Private content')",
        [ticket, org, admin],
      );
      await db.exec('update private.notification_email_outbox set available_at=now()');
      attempted = (await db.query('select * from public.claim_notification_emails(20)')).rows[0];
      await db.query('select public.finish_notification_email($1,$2,null,$3)', [
        attempted.notification_id,
        attempted.lease_token,
        'Retry',
      ]);
      await db.query(
        "select private.enqueue_notification($1,$2,null,$3,null,'ticket_response','Ticket response',false,'unattempted-name-test')",
        [org, admin, ticket],
      );
    },
  });
  try {
    await db.query("update public.tickets set title='Changed title' where id=$1", [ticket]);
    await db.exec('update private.notification_email_outbox set available_at=now()');
    const claimed = (await db.query('select * from public.claim_notification_emails(20)')).rows;
    assert.equal(
      claimed.find((n) => n.notification_id === attempted.notification_id).title,
      attempted.title,
    );
    const named = claimed.find((n) => n.notification_id !== attempted.notification_id);
    assert.equal(named.title, 'Ticket response — Printer needs help');
    await db.query('select public.finish_notification_email($1,$2,null,$3)', [
      named.notification_id,
      named.lease_token,
      'Retry',
    ]);
    await db.query("update public.tickets set title='Another title' where id=$1", [ticket]);
    await db.exec('update private.notification_email_outbox set available_at=now()');
    const retry = (await db.query('select * from public.claim_notification_emails(20)')).rows;
    assert.equal(retry.find((n) => n.notification_id === named.notification_id).title, named.title);
  } finally {
    await db.close();
  }
});
