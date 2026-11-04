import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { identity, ids, owner, seed, service } from '../../../tests/helpers/automation-worker.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const value = async (db, sql, args = []) => (await db.query(sql, args)).rows[0].value;
async function denied(db, fn, code = '42501') {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(fn, (e) => e.code === code);
  } finally {
    await db.exec('rollback to denied;release savepoint denied');
  }
}
test('72-hour invitation links are service-only, single-use, scoped, revocable and independent of email OTPs', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin');
    await seed(db);
    await owner(db);
    await db.query('update auth.users set invited_at=now(),email_confirmed_at=null where id=$1', [
      ids.employee,
    ]);
    const id = randomUUID(),
      hash = 'a'.repeat(64),
      claim = randomUUID();
    const issue = (token = id, actor = ids.admin, org = ids.org) =>
      value(db, 'select public.issue_workspace_invitation($1,$2,$3,$4,$5) value', [
        org,
        ids.employee,
        actor,
        token,
        hash,
      ]);
    const accept = (token = id, key = hash, lease = claim) =>
      value(db, 'select public.claim_workspace_invitation($1,$2,$3) value', [token, key, lease]);
    await identity(db);
    await denied(db, () => issue());
    await denied(db, () => accept());
    await identity(db, 'anon', null);
    await denied(db, () => accept());
    await service(db);
    await denied(db, () => issue(id, ids.worker));
    await denied(db, () => issue(id, ids.otherAdmin, ids.otherOrg), 'P0002');
    const issued = await issue();
    assert.equal(issued.sent, false);
    await owner(db);
    assert.equal(
      await value(
        db,
        'select extract(epoch from(expires_at-created_at))::int value from private.workspace_invitation_links where id=$1',
        [id],
      ),
      72 * 3600,
    );
    await service(db);
    await denied(db, () => accept(), 'PT410');
    await db.query('select public.mark_workspace_invitation_sent($1,$2,$3)', [
      id,
      hash,
      'provider-receipt',
    ]);
    assert.equal((await issue()).sent, true, 'same form is idempotent and does not extend expiry');
    await denied(db, () => accept(id, 'b'.repeat(64)), 'PT410');
    const accepted = await accept();
    assert.equal(accepted.userId, ids.employee);
    await denied(db, () => accept(id, hash, randomUUID()), 'PT429');
    await denied(db, () =>
      db.query('select public.finish_workspace_invitation($1,$2,true)', [id, randomUUID()]),
    );
    await db.query('select public.finish_workspace_invitation($1,$2,false)', [id, claim]);
    assert.equal(
      (await accept()).userId,
      ids.employee,
      'provider failure releases the link for retry',
    );
    await db.query('select public.finish_workspace_invitation($1,$2,true)', [id, claim]);
    await denied(db, () => accept(), 'PT410');
    // A resend creates a fresh 72-hour window, and invalidates old links only after email acceptance.
    await owner(db);
    await db.query(
      "update private.workspace_invitation_links set created_at=now()-interval '2 minutes',consumed_at=null where id=$1",
      [id],
    );
    await service(db);
    const second = randomUUID();
    await issue(second);
    await denied(db, () => issue(randomUUID()), 'PT429');
    await db.query('select public.mark_workspace_invitation_sent($1,$2,$3)', [
      second,
      hash,
      'second-receipt',
    ]);
    await denied(db, () => accept(), 'PT410');
    await owner(db);
    await db.query(
      "update private.workspace_invitation_links set expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [second],
    );
    await service(db);
    await denied(db, () => accept(second), 'PT410');
    await owner(db);
    await db.query(
      "update private.workspace_invitation_links set expires_at=now()+interval '1 hour' where id=$1",
      [second],
    );
    await db.query(
      "update public.organization_memberships set status='inactive',deactivated_at=now() where user_id=$1",
      [ids.employee],
    );
    await service(db);
    await denied(db, () => accept(second), 'PT410');
    await owner(db);
    await db.query(
      "update public.organization_memberships set status='active',deactivated_at=null where user_id=$1",
      [ids.employee],
    );
    await db.query('update auth.users set email_confirmed_at=now() where id=$1', [ids.employee]);
    await service(db);
    await denied(db, () => accept(second), 'PT410');
    await denied(db, () => issue(second), 'PT409');
    await owner(db);
    assert.equal(
      await value(
        db,
        'select token_hash value from private.workspace_invitation_links where id=$1',
        [id],
      ),
      hash,
    );
  } finally {
    await db.close();
  }
});
