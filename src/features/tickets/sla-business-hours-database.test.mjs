import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  employee = '10000000-0000-0000-0000-000000000404',
  outsider = '10000000-0000-0000-0000-000000000402';
const migration = '20261026133944_sla_business_hours.sql';
async function identity(db, id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
async function denied(db, fn) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(fn);
  } finally {
    await db.exec('rollback to denied;release savepoint denied');
  }
}
async function one(db, sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
async function create(db) {
  await db.exec('reset role');
  return (
    await one(
      db,
      "insert into public.tickets(organization_id,requester_id,title,description,priority,created_at) values($1,$2,'SLA coverage','Test','low',now()-interval '2 days') returning id",
      [org, employee],
    )
  ).id;
}

test('SLA support schedule, migration history, lifecycle and authority are enforced by Postgres', async (t) => {
  let before;
  const db = await migratedPostgres({
    beforeMigration: async (db, name) => {
      if (name !== migration) return;
      await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
      await db.query(
        "insert into public.tickets(organization_id,requester_id,title,description,status,priority,created_at) values($1,$2,'Completed before policy','Test','resolved','normal','2026-10-23T21:00Z'),($1,$2,'Open before policy','Test','open','normal','2026-10-23T21:00Z')",
        [org, employee],
      );
      before = await one(
        db,
        "select (select resolution_sla_due_at from public.tickets where title='Completed before policy') due,(select count(*) from public.ticket_activity) activity,(select count(*) from private.domain_events) events",
      );
    },
  });
  const scenario = async (name, run) =>
    t.test(name, async () => {
      await db.exec('begin');
      try {
        await run();
      } finally {
        await db.exec('rollback;reset role');
      }
    });
  try {
    await scenario(
      'cutover preserves completed results and emits no artificial activity or events',
      async () => {
        const row = await one(
          db,
          "select (select resolution_sla_due_at from public.tickets where title='Completed before policy') due,(select count(*) from public.ticket_activity) activity,(select count(*) from private.domain_events) events,(select sla_timezone from public.tickets where title='Completed before policy') old_zone,(select sla_timezone from public.tickets where title='Open before policy') new_zone",
        );
        assert.deepEqual(row.due, before.due);
        assert.equal(row.activity, before.activity);
        assert.equal(row.events, before.events);
        assert.equal(row.old_zone, null);
        assert.equal(row.new_zone, 'UTC');
      },
    );
    await scenario(
      'Friday evening continues Saturday; nights, exact closing and DST are calculated correctly',
      async () => {
        for (const [start, seconds, zone, expected] of [
          ['2026-10-23T21:00Z', 14400, 'UTC', '2026-10-24T10:00:00.000Z'],
          ['2026-10-23T22:00Z', 14400, 'UTC', '2026-10-24T11:00:00.000Z'],
          ['2026-10-24T01:00Z', 3600, 'UTC', '2026-10-24T08:00:00.000Z'],
          ['2026-10-23T21:00Z', 3600, 'UTC', '2026-10-23T22:00:00.000Z'],
          ['2026-03-08T02:00Z', 7200, 'America/New_York', '2026-03-08T12:00:00.000Z'],
          ['2026-11-01T01:00Z', 7200, 'America/New_York', '2026-11-01T13:00:00.000Z'],
          ['2026-10-24T01:15Z', 54000, 'Asia/Kathmandu', '2026-10-24T16:15:00.000Z'],
        ]) {
          const row = await one(db, 'select private.sla_add_business_seconds($1,$2,$3) due', [
            start,
            seconds,
            zone,
          ]);
          assert.equal(new Date(row.due).toISOString(), expected);
        }
        assert.equal(
          Number(
            (
              await one(
                db,
                "select private.sla_business_seconds('2026-10-23T21:00Z','2026-10-24T10:00Z','UTC') seconds",
              )
            ).seconds,
          ),
          14400,
        );
      },
    );
    await scenario(
      'waiting suppresses only resolution queue deadlines and temporal triggers; response keeps counting',
      async () => {
        const id = await create(db);
        await identity(db, admin);
        await db.query("update public.tickets set status='waiting_on_user' where id=$1", [id]);
        await db.exec('reset role');
        const row = await one(db, 'select * from public.tickets where id=$1', [id]);
        assert.ok(row.resolution_sla_paused_at);
        assert.equal(row.resolution_sla_due_at, null);
        assert.deepEqual(row.sla_next_due_at, row.response_sla_due_at);
        assert.equal(
          (
            await one(
              db,
              'select private.ticket_temporal_context(t,\'{"trigger":{"type":"ticket.sla_approaching","configuration":{"objective":"resolution","durationMinutes":30}}}\'::jsonb) context from public.tickets t where id=$1',
              [id],
            )
          ).context,
          null,
        );
        await identity(db, admin);
        await db.query(
          "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','Please send a screenshot')",
          [org, id, admin],
        );
        const replied = await one(db, 'select * from public.tickets where id=$1', [id]);
        assert.ok(replied.first_response_at);
        assert.equal(replied.sla_next_due_at, null);
        assert.equal(
          replied.resolution_sla_remaining_seconds,
          row.resolution_sla_remaining_seconds,
        );
      },
    );
    await scenario(
      'requester reply resumes once, staff notes do not, and direct employee status changes remain forbidden',
      async () => {
        const id = await create(db);
        await identity(db, admin);
        await db.query("update public.tickets set status='waiting_on_user' where id=$1", [id]);
        await db.query(
          "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'internal_note','Checking')",
          [org, id, admin],
        );
        assert.equal(
          (await one(db, 'select status from public.tickets where id=$1', [id])).status,
          'waiting_on_user',
        );
        await identity(db, employee);
        assert.equal(
          (
            await db.query(
              "update public.tickets set status='in_progress' where id=$1 returning id",
              [id],
            )
          ).rows.length,
          0,
        );
        await db.query(
          "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','Here is the screenshot')",
          [org, id, employee],
        );
        const resumed = await one(db, 'select * from public.tickets where id=$1', [id]);
        assert.equal(resumed.status, 'in_progress');
        assert.equal(resumed.resolution_sla_paused_at, null);
        assert.ok(resumed.resolution_sla_due_at);
        await db.query(
          "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','More information')",
          [org, id, employee],
        );
        assert.equal(
          (await one(db, 'select revision from public.tickets where id=$1', [id])).revision,
          resumed.revision,
        );
        await db.exec('reset role');
        assert.equal(
          Number((await one(db, 'select count(*) n from private.sla_reply_resume_contexts')).n),
          0,
        );
        assert.equal(
          Number(
            (
              await one(
                db,
                "select count(*) n from public.ticket_activity where ticket_id=$1 and action='status_changed' and details->>'to'='in_progress'",
                [id],
              )
            ).n,
          ),
          1,
        );
      },
    );
    await scenario(
      'an authenticated inbound requester reply resumes waiting but service cannot update tickets directly',
      async () => {
        const id = await create(db);
        await identity(db, admin);
        await db.query("update public.tickets set status='waiting_on_user' where id=$1", [id]);
        await db.exec('reset role');
        const sender = await one(
          db,
          'update auth.users set email_confirmed_at=now() where id=$1 returning email',
          [employee],
        );
        const ticket = await one(db, 'select ticket_number from public.tickets where id=$1', [id]);
        await db.exec('set role service_role');
        const result = await one(
          db,
          'select public.accept_inbound_email($1,$2,$3,$4,$5,true,0) result',
          [
            'sla-reply-test',
            'events-a',
            sender.email,
            `Re: [#${ticket.ticket_number}]`,
            'Information supplied by email',
          ],
        );
        assert.equal(result.result.status, 'reply_added');
        await denied(db, () =>
          db.query("update public.tickets set status='closed' where id=$1", [id]),
        );
        await db.exec('reset role');
        assert.equal(
          (await one(db, 'select status from public.tickets where id=$1', [id])).status,
          'in_progress',
        );
      },
    );
    await scenario(
      'resume grants only support time spent waiting and priority changes preserve consumed time',
      async () => {
        const id = await create(db);
        await identity(db, admin);
        await db.query("update public.tickets set status='waiting_on_user' where id=$1", [id]);
        await db.exec('reset role');
        // Simulate an overnight wait without sleeping or altering the server clock.
        await db.exec('alter table public.tickets disable trigger tickets_sla_prepare');
        await db.query(
          "update public.tickets set resolution_sla_paused_at=now()-interval '30 hours' where id=$1",
          [id],
        );
        await db.exec('alter table public.tickets enable trigger tickets_sla_prepare');
        const expected = await one(
          db,
          "select private.sla_business_seconds(now()-interval '30 hours',now(),'UTC') seconds",
        );
        await identity(db, admin);
        await db.query("update public.tickets set status='on_hold' where id=$1", [id]);
        let row = await one(db, 'select * from public.tickets where id=$1', [id]);
        assert.equal(row.sla_paused_business_seconds, Number(expected.seconds));
        assert.ok(row.resolution_sla_due_at);
        assert.equal(row.resolution_sla_paused_at, null);
        await db.query("update public.tickets set priority='high' where id=$1", [id]);
        await db.exec('reset role');
        row = await one(
          db,
          'select resolution_sla_due_at=private.sla_add_business_seconds(created_at,28800+sla_paused_business_seconds,sla_timezone) correct from public.tickets where id=$1',
          [id],
        );
        assert.equal(row.correct, true);
      },
    );
    await scenario(
      'breached targets cannot be hidden by waiting and timezone/clock state cannot be forged',
      async () => {
        const id = await create(db);
        await identity(db, admin);
        await db.query(
          "update public.tickets set priority='critical',status='waiting_on_user' where id=$1",
          [id],
        );
        const row = await one(db, 'select * from public.tickets where id=$1', [id]);
        assert.ok(row.resolution_sla_due_at);
        assert.ok(row.resolution_sla_remaining_seconds < 0);
        assert.ok(row.sla_next_due_at);
        await denied(db, () =>
          db.query(
            "update public.tickets set sla_timezone='Pacific/Auckland',sla_paused_business_seconds=999999 where id=$1",
            [id],
          ),
        );
        await identity(db, outsider);
        assert.equal(
          (await db.query('select id from public.tickets where id=$1', [id])).rows.length,
          0,
        );
        await denied(db, () =>
          db.query(
            "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'reply','Other workspace')",
            [org, id, outsider],
          ),
        );
      },
    );
  } finally {
    await db.close();
  }
});
