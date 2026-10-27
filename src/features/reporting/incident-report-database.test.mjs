import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  employee = '10000000-0000-0000-0000-000000000404',
  foreign = '10000000-0000-0000-0000-000000000402';
async function identity(db, id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
async function one(db, sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
async function denied(db, fn) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(fn);
  } finally {
    await db.exec('rollback to denied;release savepoint denied');
  }
}
test('incident updates and reports preserve approved content, safe retries, service timing and tenant boundaries', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.exec('update auth.users set email_confirmed_at=now()');
    const ticket = (
      await one(
        db,
        "insert into public.tickets(organization_id,requester_id,assigned_technician_id,title,description) values($1,$2,$3,'PRIVATE outage investigation','INTERNAL notes') returning id",
        [org, employee, admin],
      )
    ).id;
    await db.exec('begin');
    await identity(db, admin);
    const details = {
      severity: 'major',
      business_impact: 'Internal business impact',
      owner_id: admin,
      affected_services: ['Mail'],
      affected_locations: ['Office'],
      disruption_started_at: '2026-01-01T10:00:00Z',
      service_restored_at: '2026-01-01T11:30:00Z',
    };
    const revision = (await one(db, 'select revision from public.tickets where id=$1', [ticket]))
      .revision;
    await one(db, 'select public.save_ticket_incident($1,$2,$3,$4)', [
      org,
      ticket,
      revision,
      details,
    ]);
    await denied(db, () =>
      db.query(
        'select public.save_ticket_incident($1,$2,(select revision from public.tickets where id=$2),$3)',
        [org, ticket, { ...details, service_restored_at: '2026-01-01T09:00:00Z' }],
      ),
    );
    const key = randomUUID(),
      metadata = {
        public_status: 'monitoring',
        workaround: 'Use webmail while we monitor.',
        next_update_at: '2027-01-01T12:00:00Z',
      };
    const publish = async (meta = metadata, token = key, version = 0) =>
      (
        await one(db, 'select public.publish_employee_update($1,$2,$3,$4,$5,$6,$7) result', [
          org,
          ticket,
          version,
          'Mail service update',
          'Mail is recovering.',
          token,
          meta,
        ])
      ).result;
    const result = await publish();
    assert.deepEqual(await publish(), result);
    await denied(db, () => publish({ ...metadata, public_status: 'resolved' }));
    await denied(db, () => publish({ ...metadata, public_status: 'invented' }, randomUUID(), 1));
    const report = (await one(db, 'select public.incident_report($1) result', [org])).result;
    assert.equal(report.summary.total, 1);
    assert.equal(report.summary.open, 1);
    assert.equal(report.summary.downtimeMinutes, 90);
    assert.equal(report.summary.downtimeSamples, 1);
    assert.equal(report.summary.announcementSamples, 1);
    assert.equal(report.summary.resolutionMinutes, null);
    assert.equal(report.items[0].impact, 'Internal business impact');
    assert.ok(
      report.breakdowns.some((r) => r.kind === 'service' && r.label === 'Mail' && r.value === 1),
    );
    assert.equal(
      (await one(db, 'select public.incident_report($1,2) result', [org])).result.items.length,
      0,
    );
    await identity(db, employee);
    const notices = (await db.query('select * from public.service_announcements')).rows;
    assert.equal(notices[0].public_status, 'monitoring');
    assert.equal(notices[0].workaround, metadata.workaround);
    assert.doesNotMatch(JSON.stringify(notices), /PRIVATE|INTERNAL|Internal business/);
    await denied(db, () => db.query('select public.incident_report($1)', [org]));
    await denied(db, () => publish());
    await identity(db, foreign);
    await denied(db, () => db.query('select public.incident_report($1)', [org]));
    await denied(db, () => publish());
    await db.exec('reset role;set role service_role');
    const emails = (
      await db.query('select * from public.claim_notification_emails(20)')
    ).rows.filter((r) => r.service_announcement_id === result.id);
    assert.ok(emails.length > 0);
    assert.ok(
      emails.every(
        (r) =>
          r.approved_body.includes('Status: Monitoring') &&
          r.approved_body.includes(metadata.workaround) &&
          r.next_update_at,
      ),
    );
    assert.doesNotMatch(JSON.stringify(emails), /PRIVATE|INTERNAL|Internal business/);
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
