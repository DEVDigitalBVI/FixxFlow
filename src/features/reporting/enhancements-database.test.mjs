import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { identity, ids, owner, seed, ticket } from '../../../tests/helpers/automation-worker.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const rows = async (db, sql, args = []) => (await db.query(sql, args)).rows;
async function denied(db, work) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(work);
  } finally {
    await db.exec('rollback to denied;release savepoint denied');
  }
}
const definition = {
  reportType: 'volume',
  startDate: '2026-10-01',
  endDate: '2026-10-28',
  interval: 'day',
  groupBy: 'time',
  metrics: ['created', 'resolved'],
  filters: {
    statuses: [],
    priorities: [],
    categoryIds: [],
    subcategoryIds: [],
    teamIds: [],
    technicianIds: [],
    departmentIds: [],
    locationIds: [],
  },
};

test('daily schedules keep local hours, handle DST, and reuse durable idempotent delivery', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    const next = async (zone, after, hour = 8) =>
      (
        await rows(db, "select private.next_report_run('daily',null,null,$1,$2,$3)::text run", [
          hour,
          zone,
          after,
        ])
      )[0].run;
    assert.equal(
      Date.parse(await next('America/Tortola', '2026-10-27T11:00:00Z')),
      Date.parse('2026-10-27T12:00:00Z'),
    );
    assert.equal(
      Date.parse(await next('America/Tortola', '2026-10-27T12:00:00Z')),
      Date.parse('2026-10-28T12:00:00Z'),
    );
    assert.equal(
      Date.parse(await next('America/Tortola', '2026-10-31T20:00:00Z')),
      Date.parse('2026-11-01T12:00:00Z'),
    );
    assert.equal(
      Date.parse(await next('America/New_York', '2026-03-08T06:00:00Z', 2)),
      Date.parse('2026-03-08T07:00:00Z'),
    );
    assert.equal(
      Date.parse(await next('America/New_York', '2026-11-01T05:30:00Z', 1)),
      Date.parse('2026-11-01T06:00:00Z'),
    );
    assert.equal(
      Date.parse(await next('America/New_York', '2026-11-01T06:00:00Z', 1)),
      Date.parse('2026-11-02T06:00:00Z'),
    );
    await identity(db);
    const report = (
      await rows(
        db,
        "insert into public.saved_reports(organization_id,owner_id,name,visibility,definition) values($1,$2,'Daily service','shared',$3) returning id",
        [ids.org, ids.admin, JSON.stringify(definition)],
      )
    )[0].id;
    const create = (createdBy = ids.admin) =>
      rows(
        db,
        "insert into public.report_schedules(organization_id,report_id,created_by,frequency,run_hour,timezone,recipient_emails) values($1,$2,$3,'daily',8,'America/Tortola',array['reports@example.invalid']) returning id",
        [ids.org, report, createdBy],
      );
    const schedule = (await create())[0].id;
    await denied(db, () =>
      rows(db, 'update public.report_schedules set weekday=1 where id=$1', [schedule]),
    );
    await denied(db, () =>
      rows(db, "update public.report_schedules set frequency='hourly' where id=$1", [schedule]),
    );
    await owner(db);
    await db.query(
      "update public.report_schedules set next_run_at=now()-interval '1 minute' where id=$1",
      [schedule],
    );
    await identity(db, 'service_role', null);
    assert.equal((await rows(db, 'select public.enqueue_scheduled_report_deliveries() n'))[0].n, 1);
    assert.equal((await rows(db, 'select public.enqueue_scheduled_report_deliveries() n'))[0].n, 0);
    await owner(db);
    assert.equal(
      (
        await rows(
          db,
          'select count(*)::int n from private.report_deliveries where schedule_id=$1',
          [schedule],
        )
      )[0].n,
      1,
    );
    await identity(db, 'authenticated', ids.worker);
    await denied(db, () => create(ids.worker));
    await identity(db, 'authenticated', ids.employee);
    await denied(db, () => create(ids.employee));
    await identity(db, 'authenticated', ids.otherAdmin);
    await denied(db, () => create(ids.otherAdmin));
  } finally {
    await db.close();
  }
});

test('technician workload matches current backlog, distinguishes waiting and overdue, and enforces membership and MFA', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    await ticket(db, ids.otherOrg);
    await identity(db);
    await owner(db);
    for (const [status, assigned, old] of [
      ['open', ids.worker, true],
      ['waiting_on_user', ids.worker, false],
      ['open', null, false],
      ['resolved', ids.worker, false],
    ]) {
      await db.query(
        "insert into public.tickets(organization_id,requester_id,title,description,status,assigned_technician_id,created_at) values($1,$2,'Workload fixture','Request',$3,$4,now()-case when $5 then interval '60 days' else interval '0 days' end)",
        [ids.org, ids.employee, status, assigned, old],
      );
    }
    await identity(db);
    let data = await rows(db, 'select * from public.technician_workload($1)', [ids.org]);
    const tech = data.find((r) => r.user_id === ids.worker);
    assert.equal(tech.open_count, 2);
    assert.equal(tech.waiting_count, 1);
    assert.equal(tech.overdue_count, 1);
    assert.equal(data.find((r) => r.user_id === null).open_count, 1);
    assert.equal(
      data.reduce((n, r) => n + r.open_count, 0),
      (
        await rows(db, "select (public.operational_report($1)#>>'{summary,open}')::int n", [
          ids.org,
        ])
      )[0].n,
    );
    assert.equal(
      (await rows(db, 'select * from public.technician_workload($1)', [ids.otherOrg])).length,
      0,
    );
    await owner(db);
    await db.query(
      "update public.organization_memberships set status='inactive',deactivated_at=now() where user_id=$1 and organization_id=$2",
      [ids.worker, ids.org],
    );
    await identity(db);
    data = await rows(db, 'select * from public.technician_workload($1)', [ids.org]);
    assert.equal(
      data.find((r) => r.user_id === ids.worker).active,
      false,
      'inactive assignee backlog remains visible',
    );
    await identity(db, 'authenticated', ids.employee);
    assert.equal(
      (await rows(db, 'select * from public.technician_workload($1)', [ids.org])).length,
      0,
    );
    await owner(db);
    await db.query(
      "insert into auth.mfa_factors(id,user_id,factor_type,status) values($1,$2,'totp','verified')",
      [randomUUID(), ids.admin],
    );
    await identity(db);
    assert.equal(
      (await rows(db, 'select * from public.technician_workload($1)', [ids.org])).length,
      0,
    );
    await identity(db, 'anon', null);
    await denied(db, () => rows(db, 'select * from public.technician_workload($1)', [ids.org]));
  } finally {
    await db.close();
  }
});
