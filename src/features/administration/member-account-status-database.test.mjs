import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401';
const otherOrg = '20000000-0000-0000-0000-000000000402';
const admin = '10000000-0000-0000-0000-000000000401';
const employee = '10000000-0000-0000-0000-000000000404';
const foreign = '10000000-0000-0000-0000-000000000402';
async function login(db, user = admin) {
  await db.exec('reset role');
  await db.query('select pg_temp.set_test_session($1,false)', [
    JSON.stringify({ sub: user, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
async function status(db, members = [employee], organization = org) {
  return (
    await db.query('select * from public.member_account_statuses($1,$2)', [organization, members])
  ).rows;
}

test('directory labels reflect completed invitation setup and preserve independent access controls', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.query('update auth.users set invited_at=now() where id=$1', [employee]);
    await login(db);
    assert.deepEqual(await status(db), [{ user_id: employee, account_status: 'invited' }]);
    assert.equal(
      (await status(db, [admin]))[0].account_status,
      'active',
      'existing non-invited accounts remain active',
    );
    await db.exec('reset role');
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [employee]);
    await login(db);
    assert.equal(
      (await status(db))[0].account_status,
      'invited',
      'opening the invite link alone does not complete password setup',
    );
    await db.exec('reset role');
    await db.query("update auth.users set encrypted_password='test-only-hash' where id=$1", [
      employee,
    ]);
    await login(db);
    assert.equal(
      (await status(db))[0].account_status,
      'active',
      'a successful password update automatically changes the label',
    );
    await db.exec('reset role');
    await db.query(
      "update auth.users set encrypted_password='',raw_app_meta_data='\"ignored\"'::jsonb where id=$1",
      [employee],
    );
    await login(db);
    assert.equal((await status(db))[0].account_status, 'invited');
    await db.exec('reset role');
    await db.query(
      "update auth.users set raw_app_meta_data='{" +
        '"providers":["email","azure"]' +
        "}'::jsonb where id=$1",
      [employee],
    );
    await login(db);
    assert.equal(
      (await status(db))[0].account_status,
      'active',
      'supported company sign-in does not require a password',
    );
    await db.exec('reset role');
    await db.query(
      "update public.organization_memberships set status='inactive',deactivated_at=now() where organization_id=$1 and user_id=$2",
      [org, employee],
    );
    await login(db);
    assert.equal(
      (await status(db))[0].account_status,
      'inactive',
      'disabled access takes precedence over completed setup',
    );
    await db.exec('reset role');
    assert.equal(
      (
        await db.query(
          'select status from public.organization_memberships where organization_id=$1 and user_id=$2',
          [org, employee],
        )
      ).rows[0].status,
      'inactive',
    );
  } finally {
    await db.close();
  }
});

test('account-status reads are bounded, staff-only, tenant-scoped and omit deleted people and Auth details', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await login(db);
    assert.deepEqual(await status(db, [foreign]), []);
    await assert.rejects(status(db, [foreign], otherOrg), /Staff access/);
    for (const ids of [null, [], [null], Array(26).fill(employee)])
      await assert.rejects(status(db, ids), /one and 25/);
    const row = (await status(db))[0];
    assert.deepEqual(Object.keys(row).sort(), ['account_status', 'user_id']);
    await db.query('select public.delete_workspace_people($1,$2,true)', [org, [employee]]);
    assert.deepEqual(await status(db), []);
    await login(db, employee);
    await assert.rejects(status(db), /Staff access/);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims','{}',false)");
    await db.exec('set role authenticated');
    await assert.rejects(status(db), /Staff access/);
    await db.exec('reset role');
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('anon','public.member_account_statuses(uuid,uuid[])','execute') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('service_role','public.member_account_statuses(uuid,uuid[])','execute') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});
