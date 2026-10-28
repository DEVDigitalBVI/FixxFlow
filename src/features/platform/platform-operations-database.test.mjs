import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('owners export organization summaries and run audited analytics cleanup', async () => {
  const db = await migratedPostgres();
  const org = randomUUID(),
    owner = randomUUID(),
    admin = randomUUID(),
    employee = randomUUID(),
    session = randomUUID();
  const as = async (id, aal = 'aal2') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role: 'authenticated', aal, session_id: session }),
    ]);
    await db.exec('set role authenticated');
  };
  try {
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Acme Export','acme-export')",
      [org],
    );
    for (const id of [owner, admin, employee])
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
        id,
        `${id}@example.test`,
      ]);
    for (const [id, role, status] of [
      [admin, 'administrator', 'active'],
      [employee, 'end_user', 'inactive'],
    ])
      await db.query(
        "insert into public.organization_memberships(organization_id,user_id,role,status,deactivated_at) values($1,$2,$3,$4::public.membership_status,case when $4::text='inactive' then now() end)",
        [org, id, role, status],
      );
    await db.query(
      "insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,'Secret subject','Secret body')",
      [org, admin],
    );
    await db.query('insert into private.platform_owners(user_id) values($1)', [owner]);
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, owner]);

    // Customer administrators and owners without verified MFA are refused.
    await as(admin);
    for (const sql of [
      "select public.platform_organization_export('', 'csv')",
      'select public.platform_analytics_retention()',
      'select public.platform_product_usage_cleanup()',
    ])
      await assert.rejects(db.query(sql), { code: '42501' });
    await assert.rejects(db.query('select public.run_product_usage_cleanup(10)'), {
      code: '42501',
    });
    await as(owner, 'aal1');
    await assert.rejects(db.query("select public.platform_organization_export('', 'csv')"), {
      code: '42501',
    });

    await db.exec('reset role');
    await db.query(
      "insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) values($1,$2,'totp','verified',now(),now())",
      [randomUUID(), owner],
    );
    await as(owner);
    await assert.rejects(db.query("select public.platform_organization_export('', 'zip')"), {
      code: '22023',
    });
    const exported = (
      await db.query("select public.platform_organization_export('acme', 'xlsx') r")
    ).rows[0].r;
    assert.equal(exported.matchingCount, 1);
    assert.equal(exported.organizations.length, 1);
    const row = exported.organizations[0];
    assert.equal(row.name, 'Acme Export');
    assert.equal(row.administrators, 1);
    assert.equal(row.employees, 0);
    assert.equal(row.inactive_members, 1);
    assert.equal(row.tickets_total, 1);
    assert.equal(row.tickets_open, 1);
    // Aggregates only: no ticket content leaves the tenant.
    assert.doesNotMatch(JSON.stringify(exported), /Secret/);

    await db.exec('reset role');
    await db.query(
      `insert into private.product_usage_dedup(key,expires_at) values
        ('old-1',now()-interval '1 day'),('old-2',now()-interval '2 days'),('fresh',now()+interval '1 day')`,
    );
    await db.query(
      `insert into private.product_usage_counts(day,event,role,surface,count) values
        ((now() at time zone 'UTC')::date-400,'login','end_user','workspace',3),
        ((now() at time zone 'UTC')::date-10,'login','end_user','workspace',2)`,
    );
    await as(owner);
    const before = (await db.query('select public.platform_analytics_retention() r')).rows[0].r;
    assert.equal(before.expiredKeys, 2);
    assert.equal(before.expiredCounts, 1);
    assert.equal(before.lastRun, null);
    const run = (await db.query('select public.platform_product_usage_cleanup() r')).rows[0].r;
    assert.equal(run.dedupDeleted, 2);
    assert.equal(run.countsDeleted, 1);
    assert.equal(run.complete, true);
    const after = (await db.query('select public.platform_analytics_retention() r')).rows[0].r;
    assert.equal(after.expiredKeys, 0);
    assert.equal(after.lastRun.trigger, 'owner');

    await db.exec('reset role');
    assert.deepEqual((await db.query('select key from private.product_usage_dedup')).rows, [
      { key: 'fresh' },
    ]);
    assert.equal(
      (await db.query('select count(*)::int n from private.product_usage_counts')).rows[0].n,
      1,
    );
    const audit = await db.query(
      'select action,details from private.platform_audit where actor_id=$1 order by id',
      [owner],
    );
    assert.deepEqual(
      audit.rows.map((item) => item.action),
      ['organizations_exported', 'analytics_cleanup_run'],
    );
    assert.deepEqual(audit.rows[0].details, {
      format: 'xlsx',
      search: 'acme',
      organizations: '1',
    });
    for (const value of [
      ...Object.values(audit.rows[0].details),
      ...Object.values(audit.rows[1].details),
    ])
      assert.ok(value === null || typeof value === 'string');

    // The scheduled entry point runs as the service role and records its own run.
    await db.query(
      "insert into private.product_usage_dedup(key,expires_at) values('old-3',now()-interval '1 hour')",
    );
    await db.exec('set role service_role');
    const scheduled = (await db.query('select public.run_product_usage_cleanup(10) r')).rows[0].r;
    assert.equal(scheduled.dedupDeleted, 1);
    await db.exec('reset role');
    assert.deepEqual(
      (await db.query('select trigger from private.product_usage_cleanup_runs order by id')).rows,
      [{ trigger: 'owner' }, { trigger: 'schedule' }],
    );
  } finally {
    await db.close();
  }
});
