import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const user = '10000000-0000-0000-0000-000000000404',
  other = '10000000-0000-0000-0000-000000000403',
  org = '20000000-0000-0000-0000-000000000401';
async function claims(db, payload) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(payload)]);
  await db.exec('set role authenticated');
}
async function active(db) {
  return (await db.query('select public.app_session_state() state')).rows[0].state.active;
}
test('live sessions and durable revocation block stale JWTs at RLS and definer RPC boundaries', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.exec(
      "insert into public.tickets(organization_id,requester_id,title,description) values('20000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000404','Session check','Test')",
    );
    const sid = randomUUID(),
      second = randomUUID(),
      foreign = randomUUID(),
      expired = randomUUID();
    await db.query(
      "insert into auth.sessions(id,user_id,not_after) values($1,$2,null),($3,$2,null),($4,$5,null),($6,$2,now()-interval '1 minute')",
      [sid, user, second, foreign, other, expired],
    );
    const token = { sub: user, session_id: sid, role: 'authenticated', aal: 'aal1' };
    await claims(db, token);
    assert.equal(await active(db), true);
    assert.ok(
      (await db.query('select id from public.tickets where organization_id=$1', [org])).rows.length,
    );
    assert.equal(
      (await db.query('select public.revoke_app_session() revoked')).rows[0].revoked,
      true,
    );
    assert.equal(await active(db), false);
    assert.equal((await db.query('select id from public.tickets')).rows.length, 0);
    assert.equal((await db.query('select id from public.organizations')).rows.length, 0);
    await assert.rejects(db.query('select * from public.account_authentication_policy()'));
    await assert.rejects(db.query('select public.organization_sla_policy($1)', [org]));
    assert.equal(
      (await db.query('select public.revoke_app_session() revoked')).rows[0].revoked,
      true,
      'repeat logout is safe',
    );
    for (const session_id of [undefined, null, foreign, expired, 'invalid']) {
      await claims(db, { ...token, session_id });
      assert.equal(await active(db), false);
    }
    await claims(db, { ...token, session_id: second });
    assert.equal(await active(db), true, 'another device remains active');
    await db.exec('reset role');
    await db.query('delete from auth.sessions where id=$1', [second]);
    await claims(db, { ...token, session_id: second });
    assert.equal(
      await active(db),
      false,
      'Auth revocation is recognized without waiting for JWT expiry',
    );
  } finally {
    await db.close();
  }
});

test('idle deadlines apply at database boundaries and only live-session heartbeats extend them', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    const sid = randomUUID();
    await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [sid, user]);
    const token = { sub: user, session_id: sid, role: 'authenticated', aal: 'aal1' };
    await claims(db, token);
    assert.equal(await active(db), true);
    const first = (await db.query('select public.app_session_state() state')).rows[0].state;
    const passive = (await db.query('select public.app_session_state() state')).rows[0].state;
    assert.equal(passive.idle_deadline, first.idle_deadline);
    await db.exec('reset role');
    await db.query(
      "insert into private.app_sessions(session_id,user_id,last_activity_at) values($1,$2,now()-interval '29 minutes')",
      [sid, user],
    );
    await claims(db, token);
    const renewed = (await db.query('select public.touch_app_session() state')).rows[0].state;
    assert.equal(renewed.active, true);
    assert.ok(Date.parse(renewed.idle_deadline) - Date.parse(renewed.server_now) >= 1799000);
    await db.exec('reset role');
    await db.query(
      "update private.app_sessions set last_activity_at=now()-interval '31 minutes' where session_id=$1",
      [sid],
    );
    await claims(db, token);
    assert.equal(await active(db), false);
    assert.equal(
      (await db.query('select public.touch_app_session() state')).rows[0].state.active,
      false,
    );
    await assert.rejects(db.query('select * from public.account_authentication_policy()'));
    assert.equal((await db.query('select id from public.organizations')).rows.length, 0);
    await db.exec('reset role');
    await db.query(
      'update private.app_sessions set last_activity_at=now(),revoked_at=now() where session_id=$1',
      [sid],
    );
    await claims(db, token);
    assert.equal(
      (await db.query('select public.touch_app_session() state')).rows[0].state.active,
      false,
    );
  } finally {
    await db.close();
  }
});
