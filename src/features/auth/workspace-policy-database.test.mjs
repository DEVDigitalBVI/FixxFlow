import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { identity, ids, owner, seed, ticket } from '../../../tests/helpers/automation-worker.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
async function login(db, user = ids.admin, aal = 'aal1') {
  await identity(db, 'authenticated', user);
  await db.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: user, role: 'authenticated', aal }),
  ]);
}
async function denied(db, sql, args = []) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(db.query(sql, args));
  } finally {
    await db.exec('rollback to denied;release savepoint denied');
  }
}
async function factor(db, user) {
  await owner(db);
  const id = randomUUID();
  await db.query(
    "insert into auth.mfa_factors(id,user_id,factor_type,status) values($1,$2,'totp','verified')",
    [id, user],
  );
  return id;
}

test('workspace MFA is enforced for existing sessions, RLS and definer RPCs without exposing bootstrap data', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    const a = await ticket(db);
    await login(db);
    assert.equal((await one(db, 'select private.has_required_assurance() allowed')).allowed, true);
    await denied(db, 'select public.save_workspace_security_policy($1,0,true)', [ids.org]);
    const adminFactor = await factor(db, ids.admin);
    await login(db, ids.admin, 'aal2');
    assert.equal(
      (await one(db, 'select public.save_workspace_security_policy($1,0,true) revision', [ids.org]))
        .revision,
      1,
    );
    await denied(db, 'select public.save_workspace_security_policy($1,0,false)', [ids.org]);
    await login(db, ids.employee);
    assert.deepEqual(
      (await db.query('select * from public.account_authentication_policy()')).rows,
      [{ mfa_required: true, has_verified_factor: false }],
    );
    assert.equal(
      (await db.query('select * from public.tickets where id=$1', [a.id])).rows.length,
      0,
    );
    assert.equal(
      (await one(db, 'select private.is_active_organization_member($1) allowed', [ids.org]))
        .allowed,
      false,
    );
    await denied(db, 'select public.start_support_chat($1,$2,$3)', [
      ids.org,
      'Need help',
      'A direct API request',
    ]);
    await denied(db, 'select public.save_workspace_security_policy($1,1,false)', [ids.org]);
    await factor(db, ids.employee);
    await login(db, ids.employee, 'aal1');
    assert.deepEqual(
      (await db.query('select * from public.account_authentication_policy()')).rows,
      [{ mfa_required: true, has_verified_factor: true }],
    );
    assert.equal(
      (await db.query('select * from public.tickets where id=$1', [a.id])).rows.length,
      0,
    );
    await login(db, ids.employee, 'aal2');
    assert.equal(
      (await db.query('select * from public.tickets where id=$1', [a.id])).rows.length,
      1,
    );
    await login(db, ids.otherAdmin);
    assert.deepEqual(
      (await db.query('select * from public.account_authentication_policy()')).rows,
      [{ mfa_required: false, has_verified_factor: false }],
    );
    assert.equal(
      (await db.query('select * from public.workspace_security_policies')).rows.length,
      0,
    );
    await denied(db, 'select public.save_workspace_security_policy($1,1,false)', [ids.org]);
    await login(db, ids.admin, 'aal1');
    assert.equal(
      (await one(db, 'select private.can_work_tickets($1) allowed', [ids.org])).allowed,
      false,
    );
    await login(db, ids.admin, 'aal2');
    await owner(db);
    await db.query('delete from auth.mfa_factors where id=$1', [adminFactor]);
    await login(db, ids.admin, 'aal2');
    assert.equal((await one(db, 'select private.has_required_assurance() allowed')).allowed, false);
    await denied(db, 'select public.save_workspace_security_policy($1,1,false)', [ids.org]);
    await factor(db, ids.admin);
    await login(db, ids.admin, 'aal2');
    assert.equal(
      (
        await one(db, 'select public.save_workspace_security_policy($1,1,false) revision', [
          ids.org,
        ])
      ).revision,
      2,
    );
    await owner(db);
    assert.equal(
      (
        await one(
          db,
          "select count(*)::integer n from public.audit_events where entity_type='workspace_security' and organization_id=$1",
          [ids.org],
        )
      ).n,
      2,
    );
    await db.exec('rollback');
  } finally {
    await db.close();
  }
});
