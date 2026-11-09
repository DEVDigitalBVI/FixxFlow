import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401';
const admin = '10000000-0000-0000-0000-000000000401';
const employee = '10000000-0000-0000-0000-000000000404';
const outsider = '10000000-0000-0000-0000-000000000402';
async function identity(db, id) {
  await db.exec('reset role');
  await db.query('select pg_temp.set_test_session($1,false)', [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
async function one(db, query, args = []) {
  return (await db.query(query, args)).rows[0];
}
async function denied(db, query, args = []) {
  await db.exec('savepoint forbidden');
  await assert.rejects(db.query(query, args));
  await db.exec('rollback to forbidden; release savepoint forbidden');
}

test('controlled holds preserve SLA allowance, enforce follow-ups and record acknowledgment', async (t) => {
  const db = await migratedPostgres();
  const scenario = async (name, run) =>
    t.test(name, async () => {
      await db.exec('begin; reset role');
      try {
        await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
        // Full-day coverage makes elapsed/remaining checks deterministic at any test time.
        await db.query(
          'insert into private.organization_sla_policies(organization_id,targets,schedule) values($1,private.default_sla_targets(),\'{"days":[1,2,3,4,5,6,7],"opens":0,"closes":1440}\')',
          [org],
        );
        await identity(db, admin);
        await run();
      } finally {
        await db.exec('rollback; reset role');
      }
    });
  async function create(requester = employee, age = '1 hour') {
    await db.exec('reset role');
    const ticket = await one(
      db,
      "insert into public.tickets(organization_id,requester_id,assigned_technician_id,title,description,status,created_at) values($1,$2,$3,'Hold scenario','Test','open',now()-$4::interval) returning *",
      [org, requester, admin, age],
    );
    await identity(db, admin);
    return ticket;
  }
  async function hold(id) {
    return one(
      db,
      "update public.tickets set status='on_hold',hold_reason='vendor',hold_note='Vendor replacement pending',hold_review_at=now()+interval '1 day' where id=$1 returning *",
      [id],
    );
  }
  try {
    await scenario(
      'reject incomplete holds, unowned holds, past reviews and forged timing',
      async () => {
        const ticket = await create();
        await denied(db, "update public.tickets set status='on_hold' where id=$1", [ticket.id]);
        await hold(ticket.id);
        await denied(db, 'update public.tickets set assigned_technician_id=null where id=$1', [
          ticket.id,
        ]);
        await denied(
          db,
          "update public.tickets set hold_review_at=now()-interval '1 minute' where id=$1",
          [ticket.id],
        );
        await denied(db, "update public.tickets set hold_note='  ' where id=$1", [ticket.id]);
        await denied(
          db,
          'update public.tickets set acknowledged_at=now(),hold_elapsed_seconds=100000 where id=$1',
          [ticket.id],
        );
      },
    );
    await scenario(
      'hold freezes resolution, public reply satisfies response, review edits do not reset allowance',
      async () => {
        const ticket = await create();
        const held = await hold(ticket.id);
        assert.ok(held.resolution_sla_paused_at);
        assert.equal(held.resolution_sla_due_at, null);
        assert.deepEqual(held.sla_next_due_at, held.response_sla_due_at);
        await db.query(
          "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','We are coordinating a replacement')",
          [org, ticket.id, admin],
        );
        const replied = await one(db, 'select * from public.tickets where id=$1', [ticket.id]);
        assert.ok(replied.first_response_at);
        assert.equal(replied.first_response_kind, 'public_reply');
        assert.ok(replied.acknowledged_at);
        assert.equal(replied.sla_next_due_at, null);
        const reviewed = await one(
          db,
          "update public.tickets set hold_review_at=now()+interval '2 days',hold_note='Vendor confirmed progress' where id=$1 returning *",
          [ticket.id],
        );
        assert.equal(
          reviewed.resolution_sla_remaining_seconds,
          held.resolution_sla_remaining_seconds,
        );
        assert.deepEqual(reviewed.resolution_sla_paused_at, held.resolution_sla_paused_at);
        assert.equal(reviewed.revision, replied.revision + 1);
        assert.equal(
          Number(
            (
              await one(
                db,
                "select count(*) n from public.ticket_activity where ticket_id=$1 and action='hold_review_updated'",
                [ticket.id],
              )
            ).n,
          ),
          2,
        );
      },
    );
    await scenario(
      'waiting to hold stays paused; requester replies do not end a vendor hold',
      async () => {
        const ticket = await create();
        await db.query("update public.tickets set status='waiting_on_user' where id=$1", [
          ticket.id,
        ]);
        const waiting = await one(db, 'select * from public.tickets where id=$1', [ticket.id]);
        const held = await hold(ticket.id);
        assert.deepEqual(held.resolution_sla_paused_at, waiting.resolution_sla_paused_at);
        assert.equal(
          held.resolution_sla_remaining_seconds,
          waiting.resolution_sla_remaining_seconds,
        );
        await identity(db, employee);
        await db.query(
          "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','Any update?')",
          [org, ticket.id, employee],
        );
        assert.equal(
          (await one(db, 'select status from public.tickets where id=$1', [ticket.id])).status,
          'on_hold',
        );
      },
    );
    await scenario(
      'resuming adds only the recorded pause and preserves an earlier breach',
      async () => {
        const ticket = await create(employee, '4 days');
        const held = await hold(ticket.id);
        assert.ok(held.resolution_sla_remaining_seconds < 0);
        assert.ok(held.resolution_sla_due_at);
        await db.exec('reset role; alter table public.tickets disable trigger tickets_sla_prepare');
        await db.query(
          "update public.tickets set resolution_sla_paused_at=now()-interval '2 hours' where id=$1",
          [ticket.id],
        );
        await db.exec('alter table public.tickets enable trigger tickets_sla_prepare');
        await identity(db, admin);
        const resumed = await one(
          db,
          "update public.tickets set status='in_progress' where id=$1 returning *,resolution_sla_due_at<now() breached",
          [ticket.id],
        );
        assert.equal(resumed.resolution_sla_paused_at, null);
        assert.equal(resumed.hold_review_at, null);
        assert.equal(resumed.sla_paused_business_seconds, 7200);
        assert.equal(resumed.hold_elapsed_seconds, 7200);
        assert.equal(resumed.breached, true);
      },
    );
    await scenario(
      'self-assigned technician start counts once; other starts acknowledge without inventing a public reply',
      async () => {
        const own = await create(admin);
        const started = await one(
          db,
          "update public.tickets set status='in_progress' where id=$1 returning *",
          [own.id],
        );
        assert.ok(started.first_response_at);
        assert.equal(started.first_response_kind, 'work_started');
        assert.ok(started.acknowledged_at);
        await hold(own.id);
        const resumed = await one(
          db,
          "update public.tickets set status='in_progress' where id=$1 returning *",
          [own.id],
        );
        assert.deepEqual(resumed.first_response_at, started.first_response_at);
        const other = await create();
        const work = await one(
          db,
          "update public.tickets set status='in_progress' where id=$1 returning *",
          [other.id],
        );
        assert.ok(work.acknowledged_at);
        assert.equal(work.first_response_at, null);
      },
    );
    await scenario(
      'reminders deduplicate per follow-up and recipient; report and tenant permissions hold',
      async () => {
        const ticket = await create();
        await hold(ticket.id);
        await db.exec(
          'reset role; alter table public.tickets disable trigger tickets_prepare_hold',
        );
        await db.query(
          "update public.tickets set hold_review_at=now()-interval '1 minute' where id=$1",
          [ticket.id],
        );
        await db.exec(
          'alter table public.tickets enable trigger tickets_prepare_hold; set role service_role',
        );
        await db.query('select public.enqueue_hold_review_notifications()');
        await db.query('select public.enqueue_hold_review_notifications()');
        await db.exec('reset role');
        assert.equal(
          Number(
            (
              await one(
                db,
                "select count(*) n from public.notifications where ticket_id=$1 and title like '%hold follow-up overdue%'",
                [ticket.id],
              )
            ).n,
          ),
          1,
        );
        await identity(db, admin);
        const report = (await one(db, 'select public.operational_report($1) r', [org])).r;
        assert.equal(report.lifecycle.holdReviewsDue, 1);
        assert.equal(report.lifecycle.heldTickets, 1);
        await db.query("update public.tickets set status='in_progress' where id=$1", [ticket.id]);
        await db.exec('reset role');
        const obsolete = await one(
          db,
          "select q.status from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.ticket_id=$1 and n.kind='hold_review_due'",
          [ticket.id],
        );
        assert.equal(obsolete.status, 'skipped');
        await identity(db, employee);
        await denied(db, 'select public.enqueue_hold_review_notifications()');
        await denied(db, 'select public.operational_report($1)', [org]);
        await identity(db, outsider);
        assert.equal(
          (await db.query('select id from public.tickets where id=$1', [ticket.id])).rows.length,
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});

test('cutover preserves legacy hold deadlines and does not invent acknowledgment or pause history', async () => {
  let before;
  const db = await migratedPostgres({
    beforeMigration: async (db, name) => {
      if (name !== '20261109162844_controlled_ticket_sla_workflow.sql') return;
      await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
      before = await one(
        db,
        "insert into public.tickets(organization_id,requester_id,assigned_technician_id,title,description,status) values($1,$2,$3,'Existing hold','Test','on_hold') returning *",
        [org, employee, admin],
      );
    },
  });
  try {
    const after = await one(db, 'select * from public.tickets where id=$1', [before.id]);
    assert.deepEqual(after.resolution_sla_due_at, before.resolution_sla_due_at);
    assert.equal(after.acknowledged_at, null);
    assert.equal(after.resolution_sla_paused_at, null);
    assert.equal(after.hold_review_at, null);
    await identity(db, admin);
    const edited = await one(
      db,
      "update public.tickets set title='Reviewed title' where id=$1 returning *",
      [before.id],
    );
    assert.equal(
      edited.resolution_sla_paused_at,
      null,
      'unrelated edits do not silently pause an undocumented hold',
    );
    const documented = await one(
      db,
      "update public.tickets set hold_reason='parts',hold_note='Replacement ordered',hold_review_at=now()+interval '1 day' where id=$1 returning *",
      [before.id],
    );
    assert.ok(documented.resolution_sla_paused_at);
  } finally {
    await db.close();
  }
});
