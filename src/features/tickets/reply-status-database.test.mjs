import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  worker = '10000000-0000-0000-0000-000000000403',
  employee = '10000000-0000-0000-0000-000000000404',
  outsider = '10000000-0000-0000-0000-000000000402';
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
async function identity(db, id) {
  await db.exec('reset role');
  await db.query('select pg_temp.set_test_session($1,false)', [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
async function denied(db, sql, args = [], code) {
  await db.exec('savepoint denied');
  await assert.rejects(db.query(sql, args), code ? (e) => e.code === code : undefined);
  await db.exec('rollback to denied; release savepoint denied');
}
const sql = 'select * from public.reply_and_set_ticket_status($1,$2,$3,$4,$5)';

test('atomic replies run against actual authorization, SLA, history and notification triggers', async (t) => {
  const db = await migratedPostgres();
  async function scenario(name, run) {
    await t.test(name, async () => {
      await db.exec('begin; reset role');
      try {
        await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
        await db.exec('update auth.users set email_confirmed_at=now()');
        await db.query(
          `insert into private.organization_sla_policies(organization_id,targets,schedule) values($1,private.default_sla_targets(),'{"days":[1,2,3,4,5,6,7],"opens":0,"closes":1440}')`,
          [org],
        );
        const ticket = await one(
          db,
          `insert into public.tickets(organization_id,requester_id,assigned_technician_id,title,description,status) values($1,$2,$3,'Atomic reply','Private request','open') returning *`,
          [org, employee, admin],
        );
        await identity(db, admin);
        await run(ticket);
      } finally {
        await db.exec('rollback; reset role');
      }
    });
  }
  try {
    const rpc = await one(
      db,
      "select prosecdef,proconfig from pg_proc where oid='public.reply_and_set_ticket_status(uuid,uuid,text,public.ticket_status,bigint)'::regprocedure",
    );
    assert.equal(rpc.prosecdef, false, 'ticket and message writes retain caller permissions');
    assert.ok(rpc.proconfig.some((value) => value.startsWith('search_path=')));
    const permissions = await one(
      db,
      `select
      has_function_privilege('anon','public.reply_and_set_ticket_status(uuid,uuid,text,public.ticket_status,bigint)','execute') anon_rpc,
      has_function_privilege('authenticated','private.confirm_ticket_reply_status()','execute') direct_confirmation,
      has_table_privilege('authenticated','private.ticket_reply_status_receipts','update') receipt_update,
      (select relrowsecurity from pg_class where oid='private.ticket_reply_status_receipts'::regclass) receipt_rls`,
    );
    assert.deepEqual(permissions, {
      anon_rpc: false,
      direct_confirmation: false,
      receipt_update: false,
      receipt_rls: true,
    });
    await scenario(
      'first public reply and waiting succeeds, acknowledgment and pause both recorded',
      async (ticket) => {
        const message = randomUUID();
        const result = await one(db, sql, [
          ticket.id,
          message,
          'What happens when you reconnect?',
          'waiting_on_user',
          ticket.revision,
        ]);
        assert.equal(result.message_sent, true);
        assert.equal(result.status_changed, true);
        assert.equal(result.already_sent, false);
        const current = await one(db, 'select * from public.tickets where id=$1', [ticket.id]);
        assert.equal(current.status, 'waiting_on_user');
        assert.ok(current.first_response_at);
        assert.ok(current.acknowledged_at);
        assert.equal(current.first_response_kind, 'public_reply');
        assert.equal(current.revision, ticket.revision + 2);
        assert.equal(result.revision, current.revision);
        assert.ok(current.resolution_sla_paused_at);
        assert.ok(current.resolution_sla_remaining_seconds > 0);
        assert.equal(current.resolution_sla_due_at, null);
        assert.equal(
          (
            await one(
              db,
              "select count(*)::int n from public.ticket_activity where ticket_id=$1 and action='reply_added'",
              [ticket.id],
            )
          ).n,
          1,
        );
      },
    );
    await scenario(
      'another worker revision conflict sends nothing and leaves status intact',
      async (ticket) => {
        await identity(db, worker);
        await db.query("update public.tickets set priority='high' where id=$1", [ticket.id]);
        await identity(db, admin);
        await denied(
          db,
          sql,
          [ticket.id, randomUUID(), 'Question', 'waiting_on_user', ticket.revision],
          'PT409',
        );
        assert.equal(
          (
            await one(db, 'select count(*)::int n from public.ticket_messages where ticket_id=$1', [
              ticket.id,
            ])
          ).n,
          0,
        );
        const current = await one(db, 'select * from public.tickets where id=$1', [ticket.id]);
        assert.equal(current.status, 'open');
        assert.equal(current.first_response_at, null);
      },
    );
    await scenario(
      'lost-response retry returns receipt before stale revision check and never reapplies old status',
      async (ticket) => {
        const args = [ticket.id, randomUUID(), 'Question', 'waiting_on_user', ticket.revision];
        const first = await one(db, sql, args);
        await db.query("update public.tickets set status='in_progress' where id=$1", [ticket.id]);
        const retry = await one(db, sql, args);
        assert.deepEqual(retry, { ...first, already_sent: true });
        assert.equal(
          (await one(db, 'select status from public.tickets where id=$1', [ticket.id])).status,
          'in_progress',
        );
        assert.equal(
          (
            await one(db, 'select count(*)::int n from public.ticket_messages where ticket_id=$1', [
              ticket.id,
            ])
          ).n,
          1,
        );
        for (const [index, value] of [
          [2, 'Different'],
          [3, 'resolved'],
          [4, ticket.revision + 1],
        ]) {
          const changed = [...args];
          changed[index] = value;
          await denied(db, sql, changed, 'PT422');
        }
      },
    );
    await scenario(
      'plain identical reply confirms only message; internal note and another author are rejected',
      async (ticket) => {
        const message = randomUUID();
        await db.query(
          "insert into public.ticket_messages(id,organization_id,ticket_id,author_id,body) values($1,$2,$3,$4,'Question')",
          [message, org, ticket.id, admin],
        );
        const duplicate = await one(db, sql, [
          ticket.id,
          message,
          'Question',
          'waiting_on_user',
          ticket.revision,
        ]);
        assert.equal(duplicate.message_sent, true);
        assert.equal(duplicate.status_changed, false);
        await identity(db, worker);
        await denied(
          db,
          sql,
          [ticket.id, message, 'Question', 'waiting_on_user', ticket.revision],
          'PT422',
        );
        await identity(db, admin);
        const note = randomUUID();
        await db.query(
          "insert into public.ticket_messages(id,organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,$4,'internal_note','Private')",
          [note, org, ticket.id, admin],
        );
        await denied(db, sql, [ticket.id, note, 'Private', 'resolved', ticket.revision], 'PT422');
      },
    );
    await scenario(
      'employees, cross-tenant workers, anonymous calls and invalid targets are rejected',
      async (ticket) => {
        for (const actor of [employee, outsider]) {
          await identity(db, actor);
          await denied(
            db,
            sql,
            [ticket.id, randomUUID(), 'Question', 'waiting_on_user', ticket.revision],
            '42501',
          );
        }
        await db.exec('reset role; set role anon');
        await denied(
          db,
          sql,
          [ticket.id, randomUUID(), 'Question', 'waiting_on_user', ticket.revision],
          '42501',
        );
        await identity(db, admin);
        for (const status of ['on_hold', 'in_progress'])
          await denied(
            db,
            sql,
            [ticket.id, randomUUID(), 'Question', status, ticket.revision],
            '22023',
          );
        assert.equal(
          (
            await one(db, 'select count(*)::int n from public.ticket_messages where ticket_id=$1', [
              ticket.id,
            ])
          ).n,
          0,
        );
      },
    );
    await scenario(
      'status validation failure rolls back reply, acknowledgment, activity, emails and receipt',
      async (ticket) => {
        await db.exec(
          `reset role; create function pg_temp.reject_combined_resolution() returns trigger language plpgsql as $$ begin if new.status='resolved' then raise exception 'Test status rejection' using errcode='22023'; end if; return new; end $$; create trigger reject_test_status before update on public.tickets for each row execute function pg_temp.reject_combined_resolution();`,
        );
        await identity(db, admin);
        await denied(
          db,
          sql,
          [ticket.id, randomUUID(), 'Fixed', 'resolved', ticket.revision],
          '22023',
        );
        const current = await one(db, 'select * from public.tickets where id=$1', [ticket.id]);
        assert.equal(current.status, 'open');
        assert.equal(current.revision, ticket.revision);
        assert.equal(current.first_response_at, null);
        assert.equal(
          (
            await one(db, 'select count(*)::int n from public.ticket_messages where ticket_id=$1', [
              ticket.id,
            ])
          ).n,
          0,
        );
        assert.equal(
          (
            await one(
              db,
              'select count(*)::int n from private.ticket_reply_status_receipts where ticket_id=$1',
              [ticket.id],
            )
          ).n,
          0,
        );
        assert.equal(
          (
            await one(
              db,
              "select count(*)::int n from public.notifications where ticket_id=$1 and kind='ticket_response'",
              [ticket.id],
            )
          ).n,
          0,
        );
        assert.equal(
          (
            await one(
              db,
              "select count(*)::int n from public.ticket_activity where ticket_id=$1 and action='reply_added'",
              [ticket.id],
            )
          ).n,
          0,
        );
      },
    );
    await scenario(
      'waiting sends one requester reply email with waiting context; staff copy is preserved',
      async (ticket) => {
        // Use a second staff author so the assigned owner also receives their existing reply notification.
        await identity(db, worker);
        const message = randomUUID();
        await one(db, sql, [
          ticket.id,
          message,
          'Please reconnect',
          'waiting_on_user',
          ticket.revision,
        ]);
        await db.exec('reset role');
        const rows = (
          await db.query(
            `select n.recipient_id,n.kind,q.ticket_status from public.notifications n join private.notification_email_outbox q on q.notification_id=n.id where n.ticket_id=$1 and n.kind in ('ticket_response','ticket_resolved','ticket_reopened') order by n.recipient_id`,
            [ticket.id],
          )
        ).rows;
        assert.deepEqual(
          rows.filter((r) => r.recipient_id === employee),
          [{ recipient_id: employee, kind: 'ticket_response', ticket_status: 'waiting_on_user' }],
        );
        assert.equal(rows.find((r) => r.recipient_id === admin).ticket_status, 'open');
        await db.exec('update private.notification_email_outbox set available_at=now()');
        const mail = (
          await db.query('select * from public.claim_notification_emails(20)')
        ).rows.find(
          (r) =>
            r.email_kind === 'ticket_response' &&
            r.recipient_email === 'events-requester@example.invalid',
        );
        assert.equal(mail.ticket_status, 'waiting_on_user');
        assert.equal(mail.reply_preview, 'Please reconnect');
      },
    );
    await scenario(
      'resolution retains a separate requester resolution notification and rating destination',
      async (ticket) => {
        const result = await one(db, sql, [
          ticket.id,
          randomUUID(),
          'Fixed',
          'resolved',
          ticket.revision,
        ]);
        assert.equal(result.status_changed, true);
        const current = await one(db, 'select * from public.tickets where id=$1', [ticket.id]);
        assert.equal(current.status, 'resolved');
        assert.ok(current.resolved_at);
        await db.exec('reset role');
        const kinds = (
          await db.query(
            'select kind from public.notifications where ticket_id=$1 and recipient_id=$2',
            [ticket.id, employee],
          )
        ).rows
          .map((r) => r.kind)
          .sort();
        assert.deepEqual(kinds, ['ticket_resolved', 'ticket_response']);
        await identity(db, admin);
        await denied(
          db,
          sql,
          [ticket.id, randomUUID(), 'More', 'waiting_on_user', current.revision],
          '22023',
        );
      },
    );
    await scenario(
      'private receipts cannot be forged, updated or read across workers',
      async (ticket) => {
        const message = randomUUID();
        await one(db, sql, [ticket.id, message, 'Question', 'waiting_on_user', ticket.revision]);
        await denied(
          db,
          'update private.ticket_reply_status_receipts set result_revision=99 where message_id=$1',
          [message],
          '42501',
        );
        await identity(db, worker);
        assert.equal(
          (
            await db.query(
              'select * from private.ticket_reply_status_receipts where message_id=$1',
              [message],
            )
          ).rows.length,
          0,
        );
        await denied(
          db,
          `insert into private.ticket_reply_status_receipts(message_id,organization_id,ticket_id,actor_id,body_sha256,requested_status,expected_revision,result_revision) values($1,$2,$3,$4,'fake','waiting_on_user',1,99)`,
          [randomUUID(), org, ticket.id, worker],
          '22023',
        );
      },
    );
  } finally {
    await db.close();
  }
});
