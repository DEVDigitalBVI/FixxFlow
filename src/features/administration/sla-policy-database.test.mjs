import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  employee = '10000000-0000-0000-0000-000000000404',
  outsider = '10000000-0000-0000-0000-000000000402';
async function identity(db, id) {
  await db.exec('reset role');
  await db.query('select pg_temp.set_test_session($1,false)', [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
async function denied(db, run) {
  await db.exec('savepoint rejected');
  try {
    await assert.rejects(run);
  } finally {
    await db.exec('rollback to rejected;release savepoint rejected');
  }
}
async function one(db, sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
test('organization SLA policies enforce authority, snapshots, working days and optimistic concurrency in Postgres', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.exec('begin');
    await identity(db, admin);
    let { policy } = await one(db, 'select public.organization_sla_policy($1) policy', [org]);
    assert.equal(policy.version, 0);
    await db.exec('reset role');
    const old = await one(
      db,
      "insert into public.tickets(organization_id,requester_id,title,description,priority,created_at) values($1,$2,'Original policy','Test','high','2026-10-30T16:00Z') returning id,response_sla_due_at,resolution_sla_due_at",
      [org, employee],
    );
    await identity(db, admin);
    policy.targets.high = { response: 120, resolution: 600 };
    const schedule = { days: [1, 2, 3, 4, 5], opens: 540, closes: 1020 };
    const save = (version = 0, targets = policy.targets, hours = schedule) =>
      db.query('select public.save_organization_sla_policy($1,$2,$3,$4) version', [
        org,
        version,
        JSON.stringify(targets),
        JSON.stringify(hours),
      ]);
    assert.equal((await save()).rows[0].version, 1);
    await denied(db, () => save());
    await denied(db, () => save(1, { ...policy.targets, high: { response: 0, resolution: 600 } }));
    await denied(db, () => save(1, policy.targets, { ...schedule, days: [] }));
    await denied(db, () => save(1, policy.targets, { ...schedule, closes: 500 }));
    await identity(db, employee);
    assert.equal(
      (await one(db, 'select public.organization_sla_policy($1) policy', [org])).policy.version,
      1,
    );
    await denied(db, () => save(1));
    await identity(db, outsider);
    await denied(db, () => db.query('select public.organization_sla_policy($1)', [org]));
    await denied(db, () => save(1));
    await identity(db, admin);
    await db.exec('reset role');
    const current = await one(
      db,
      "insert into public.tickets(organization_id,requester_id,title,description,priority,created_at) values($1,$2,'Custom policy','Test','high','2026-10-30T16:00Z') returning id,response_sla_due_at,resolution_sla_due_at,sla_schedule",
      [org, employee],
    );
    assert.equal(current.response_sla_due_at.toISOString(), '2026-11-02T10:00:00.000Z');
    assert.equal(current.resolution_sla_due_at.toISOString(), '2026-11-03T10:00:00.000Z');
    assert.deepEqual(current.sla_schedule, schedule);
    await identity(db, admin);
    await save(
      1,
      { ...policy.targets, high: { response: 30, resolution: 60 } },
      { days: [1, 2, 3, 4, 5, 6, 7], opens: 0, closes: 1440 },
    );
    await db.exec('reset role');
    const preserved = await one(
      db,
      'update public.tickets set sla_targets=private.default_sla_targets(),sla_schedule=private.default_sla_schedule() where id=$1 returning response_sla_due_at,resolution_sla_due_at,sla_schedule',
      [current.id],
    );
    assert.deepEqual(preserved.response_sla_due_at, current.response_sla_due_at);
    assert.deepEqual(preserved.sla_schedule, schedule);
    const unchanged = await one(
      db,
      'select response_sla_due_at,resolution_sla_due_at from public.tickets where id=$1',
      [old.id],
    );
    assert.deepEqual(unchanged.response_sla_due_at, old.response_sla_due_at);
    assert.deepEqual(unchanged.resolution_sla_due_at, old.resolution_sla_due_at);
    const seconds = await one(
      db,
      "select private.sla_business_seconds('2026-10-30T16:00Z','2026-11-02T10:00Z','UTC',$1) n",
      [JSON.stringify(schedule)],
    );
    assert.equal(seconds.n, 7200);
    const audits = await one(
      db,
      "select count(*)::int n from public.audit_events where entity_type='organization_sla_policies' and organization_id=$1",
      [org],
    );
    assert.equal(audits.n, 2);
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
