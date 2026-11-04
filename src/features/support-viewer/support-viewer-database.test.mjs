import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { identity, ids, owner, seed, ticket } from '../../../tests/helpers/automation-worker.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const value = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].value;
async function denied(db, work, code = '42501') {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(work, (error) => error.code === code);
  } finally {
    await db.exec('rollback to denied;release savepoint denied');
  }
}
test('employee insight permissions expose bounded summaries without expanding raw ticket access', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    const issue = await ticket(db),
      other = await ticket(db, ids.otherOrg);
    await identity(db);
    await owner(db);
    await db.query(
      "update public.tickets set requester_id=$1,priority='high',assigned_technician_id=$2 where id=$3",
      [ids.admin, ids.worker, issue.id],
    );
    await db.query(
      "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'internal_note','PRIVATE INTERNAL NOTE')",
      [ids.org, issue.id, ids.worker],
    );
    await db.query(
      "insert into public.ticket_attachments(organization_id,ticket_id,uploaded_by,file_name,storage_path,content_type,size_bytes) values($1,$2,$3,'private.txt','private/file.txt','text/plain',10)",
      [ids.org, issue.id, ids.worker],
    );
    await identity(db, 'authenticated', ids.employee);
    assert.deepEqual(await value(db, 'select public.support_viewer_access($1) value', [ids.org]), {
      dashboard: false,
      sharedIncidents: false,
    });
    await denied(db, () => db.query('select public.support_viewer_dashboard($1)', [ids.org]));
    await denied(db, () => db.query('select public.shared_incidents($1)', [ids.org]));
    const grant = (dashboard, shared, revision) =>
      db.query('select public.set_support_viewer_access($1,$2,$3,$4,$5)', [
        ids.org,
        ids.employee,
        dashboard,
        shared,
        revision,
      ]);
    await denied(db, () => grant(true, true, 0));
    await identity(db, 'authenticated', ids.worker);
    await denied(db, () => grant(true, true, 0));
    await identity(db);
    await grant(true, false, 0);
    await denied(db, () => grant(true, true, 0), '40001');
    await identity(db, 'authenticated', ids.employee);
    const dashboard = await value(db, 'select public.support_viewer_dashboard($1) value', [
      ids.org,
    ]);
    assert.equal(dashboard.report.summary.open, 1);
    assert.equal(dashboard.report.daily.length, 14);
    assert.deepEqual(dashboard.report.breakdowns, []);
    assert.deepEqual(dashboard.report.sla, []);
    assert.doesNotMatch(
      JSON.stringify(dashboard),
      /SECRET DESCRIPTION|PRIVATE INTERNAL NOTE|requester_id|user_id|ticket_id/,
    );
    await denied(db, () => db.query('select public.shared_incidents($1)', [ids.org]));
    await denied(db, () => db.query('select public.operational_report($1)', [ids.org]));
    await denied(db, () => db.query('select public.support_viewer_dashboard($1)', [ids.otherOrg]));
    await denied(db, () =>
      db.query('select public.support_viewer_access($1,$2)', [ids.org, [ids.admin]]),
    );
    await identity(db);
    await grant(true, true, 1);
    const publish = (published, revision, id = issue.id) =>
      db.query('select public.save_shared_incident($1,$2,$3,$4,$5,$6,$7)', [
        ids.org,
        id,
        'Office connectivity',
        'A network interruption affects the office.',
        'Replaced the faulty switch.',
        published,
        revision,
      ]);
    await publish(false, 0);
    await identity(db, 'authenticated', ids.employee);
    assert.equal((await value(db, 'select public.shared_incidents($1) value', [ids.org])).count, 0);
    await denied(db, () => publish(true, 1));
    await identity(db, 'authenticated', ids.worker);
    await publish(true, 1);
    await denied(db, () => publish(true, 1), '40001');
    await denied(db, () => publish(true, 0, other.id), 'P0002');
    await identity(db, 'authenticated', ids.employee);
    let feed = await value(db, 'select public.shared_incidents($1) value', [ids.org]);
    assert.equal(feed.count, 1);
    assert.equal(feed.rows[0].resolution, 'Replaced the faulty switch.');
    assert.doesNotMatch(
      JSON.stringify(feed),
      /SECRET DESCRIPTION|PRIVATE INTERNAL NOTE|private.txt|author_id|requester_id/,
    );
    assert.equal(
      (await value(db, "select public.shared_incidents($1,null,'switch') value", [ids.org])).count,
      1,
    );
    assert.equal(
      (
        await value(db, "select public.shared_incidents($1,null,'PRIVATE INTERNAL NOTE') value", [
          ids.org,
        ])
      ).count,
      0,
    );
    assert.equal(
      (await value(db, "select public.shared_incidents($1,null,'',1,'incidents') value", [ids.org]))
        .count,
      0,
    );
    assert.equal(
      await value(db, 'select count(*)::int value from public.tickets where id=$1', [issue.id]),
      0,
    );
    assert.equal(
      await value(db, 'select count(*)::int value from public.ticket_messages where ticket_id=$1', [
        issue.id,
      ]),
      0,
    );
    assert.equal(
      await value(
        db,
        'select count(*)::int value from public.ticket_attachments where ticket_id=$1',
        [issue.id],
      ),
      0,
    );
    assert.equal(
      (
        await db.query("update public.tickets set title='Not allowed' where id=$1 returning id", [
          issue.id,
        ])
      ).rows.length,
      0,
    );
    await denied(db, () =>
      db.query(
        "insert into public.ticket_messages(organization_id,ticket_id,author_id,body) values($1,$2,$3,'Not allowed')",
        [ids.org, issue.id, ids.employee],
      ),
    );
    // Downgrading priority withdraws visibility immediately; incident classification restores eligibility.
    await identity(db);
    await owner(db);
    await db.query("update public.tickets set priority='normal' where id=$1", [issue.id]);
    await identity(db, 'authenticated', ids.employee);
    assert.equal(
      (await value(db, 'select public.shared_incidents($1,$2) value', [ids.org, issue.id])).count,
      0,
    );
    await identity(db);
    await denied(db, () => publish(true, 2), '22023');
    await identity(db);
    await owner(db);
    const revision = (await db.query('select revision from public.tickets where id=$1', [issue.id]))
      .rows[0].revision;
    await db.query('select public.save_ticket_incident($1,$2,$3,$4)', [
      ids.org,
      issue.id,
      revision,
      {
        severity: 'major',
        business_impact: 'Office interruption',
        owner_id: ids.worker,
        affected_services: ['Internet'],
        affected_locations: ['Office'],
      },
    ]);
    await identity(db, 'authenticated', ids.employee);
    assert.equal((await value(db, 'select public.shared_incidents($1) value', [ids.org])).count, 1);
    await identity(db);
    await publish(false, 2);
    await identity(db, 'authenticated', ids.employee);
    assert.equal((await value(db, 'select public.shared_incidents($1) value', [ids.org])).count, 0);
    await identity(db);
    await grant(false, true, 2);
    await identity(db, 'authenticated', ids.employee);
    await denied(db, () => db.query('select public.support_viewer_dashboard($1)', [ids.org]));
    await identity(db);
    await owner(db);
    await db.query(
      "update public.organization_memberships set status='inactive',deactivated_at=now() where organization_id=$1 and user_id=$2",
      [ids.org, ids.employee],
    );
    await identity(db, 'authenticated', ids.employee);
    await denied(db, () => db.query('select public.shared_incidents($1)', [ids.org]));
    await identity(db);
    await owner(db);
    await db.query(
      "update public.organization_memberships set status='active',deactivated_at=null where organization_id=$1 and user_id=$2",
      [ids.org, ids.employee],
    );
    await db.query(
      "insert into auth.mfa_factors(id,user_id,factor_type,status) values($1,$2,'totp','verified')",
      [randomUUID(), ids.employee],
    );
    await identity(db, 'authenticated', ids.employee);
    await denied(db, () => db.query('select public.shared_incidents($1)', [ids.org]));
    await identity(db, 'anon', null);
    await denied(db, () => db.query('select public.support_viewer_access($1)', [ids.org]));
    await identity(db, 'authenticated', ids.otherAdmin);
    await denied(db, () => db.query('select public.shared_incidents($1)', [ids.org]));
    await identity(db);
    await owner(db);
    assert.ok(
      (await value(
        db,
        "select count(*)::int value from public.audit_events where entity_label in ('Employee insight access','Shared incident summary')",
      )) >= 6,
    );
  } finally {
    await db.close();
  }
});
