import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401';
const foreignOrg = '20000000-0000-0000-0000-000000000402';
const admin = '10000000-0000-0000-0000-000000000401';
const foreign = '10000000-0000-0000-0000-000000000402';
const staff = '10000000-0000-0000-0000-000000000403';
const employee = '10000000-0000-0000-0000-000000000404';
const user = (n) => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function identity(db, id = admin, aal = 'aal1') {
  await db.exec('reset role');
  await db.query('select pg_temp.set_test_session($1,false)', [
    JSON.stringify({ sub: id, role: 'authenticated', aal }),
  ]);
  await db.exec('set role authenticated');
}
async function denied(db, fn, code) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(fn, code ? { code } : undefined);
  } finally {
    await db.exec('rollback to denied; release savepoint denied');
  }
}
async function scalar(db, sql, args = []) {
  return (await db.query(sql, args)).rows[0].result;
}
const prepare = (db, token = randomUUID(), title = 'Email to ticket is ready') =>
  scalar(db, 'select public.prepare_email_announcement($1,$2,$3,$4) result', [
    org,
    token,
    title,
    'Email your IT team from your registered work address.',
  ]);
const read = (db, id, page = 1) =>
  scalar(db, 'select public.read_email_announcements($1,$2,$3) result', [org, id, page]);
const queue = (db, id) =>
  scalar(db, 'select public.queue_email_announcement($1,$2) result', [org, id]);
const claim = async (db) => {
  await db.exec('reset role;set role service_role');
  return (await db.query('select * from public.claim_email_announcements(10)')).rows;
};

test('email announcement drafts, recipient snapshots and leased delivery preserve access and retries', async (t) => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.exec('update auth.users set email_confirmed_at=now()');
    for (let n = 1; n <= 55; n++) {
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
        user(n),
        `employee${n}@example.invalid`,
      ]);
      await db.query(
        "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'end_user')",
        [org, user(n)],
      );
    }
    // Invited pending, unverified, inactive and deleted users are excluded.
    await db.query("update auth.users set invited_at=now(),encrypted_password='' where id=$1", [
      user(1),
    ]);
    await db.query('update auth.users set email_confirmed_at=null where id=$1', [user(2)]);
    await db.query(
      "update public.organization_memberships set status='inactive',deactivated_at=now() where user_id=$1",
      [user(3)],
    );
    await db.query(
      "update public.organization_memberships set status='inactive',deactivated_at=now(),deleted_at=now() where user_id=$1",
      [user(4)],
    );
    // Password and SSO invitation acceptance both count as completed signup.
    await db.query("update auth.users set invited_at=now(),encrypted_password='hash' where id=$1", [
      user(5),
    ]);
    await db.query(
      `update auth.users set invited_at=now(),encrypted_password='',raw_app_meta_data='{"providers":["google"]}' where id=$1`,
      [user(6)],
    );
    const scenario = (name, run) =>
      t.test(name, async () => {
        await db.exec('begin');
        try {
          await run();
        } finally {
          await db.exec('rollback;reset role');
        }
      });
    await scenario(
      'review snapshots only eligible members, pages recipients and sends nothing',
      async () => {
        await identity(db);
        const id = await prepare(db);
        const first = await read(db, id);
        assert.equal(first.counts.total, 54);
        assert.equal(first.recipients.length, 50);
        assert.equal(first.campaign.queued_at, null);
        assert.doesNotMatch(JSON.stringify(first), /encrypted_password|raw_app_meta_data|hash/);
        const second = await read(db, id, 2);
        assert.equal(second.recipients.length, 4);
        const ids = [...first.recipients, ...second.recipients].map((r) => r.user_id);
        assert.equal(new Set(ids).size, 54);
        for (const id of [foreign, user(1), user(2), user(3), user(4)])
          assert.ok(!ids.includes(id));
        assert.ok(ids.includes(user(5)) && ids.includes(user(6)));
        assert.ok(ids.includes(admin) && ids.includes(staff));
        assert.deepEqual(await claim(db), []);
      },
    );
    await scenario(
      'stable draft keys preserve content and recipient snapshot; changed payloads reject',
      async () => {
        await identity(db);
        const token = randomUUID();
        assert.equal(await prepare(db, token), token);
        await db.exec('reset role');
        await db.query(
          "update public.organization_memberships set status='inactive',deactivated_at=now() where user_id=$1",
          [employee],
        );
        await identity(db);
        assert.equal(await prepare(db, token), token);
        assert.equal((await read(db, token)).counts.total, 54);
        await denied(db, () => prepare(db, token, 'Different subject'), 'PT409');
      },
    );
    await scenario('retrying a queued draft never repopulates removed recipients', async () => {
      await identity(db);
      const token = randomUUID();
      await prepare(db, token);
      await queue(db, token);
      await db.exec('reset role');
      await db.query('delete from private.email_announcement_recipients where campaign_id=$1', [
        token,
      ]);
      await identity(db);
      assert.equal(await prepare(db, token), token);
      assert.equal((await read(db, token)).counts.total, 0);
      assert.deepEqual(await claim(db), []);
    });
    await scenario(
      'admins alone can prepare, read and queue; other tenants cannot access drafts',
      async () => {
        await identity(db);
        const id = await prepare(db);
        for (const actor of [employee, staff, foreign]) {
          await identity(db, actor);
          await denied(db, () => prepare(db), '42501');
          await denied(db, () => read(db, id), '42501');
          await denied(db, () => queue(db, id), '42501');
        }
        await identity(db, foreign);
        assert.equal(
          await scalar(db, 'select public.read_email_announcements($1,$2) result', [
            foreignOrg,
            id,
          ]),
          null,
        );
        for (const role of ['anon', 'service_role']) {
          await db.exec(`reset role;set role ${role}`);
          await denied(db, () => prepare(db), '42501');
        }
        await identity(db);
        await denied(db, () => db.query('select * from private.email_announcements'), '42501');
        await denied(
          db,
          () => db.query('select * from public.claim_email_announcements()'),
          '42501',
        );
      },
    );
    await scenario(
      'queue rechecks eligibility, is idempotent and audits exactly once',
      async () => {
        await identity(db);
        const id = await prepare(db);
        await db.exec('reset role');
        await db.query(
          "update public.organization_memberships set status='inactive',deactivated_at=now() where user_id=$1",
          [employee],
        );
        await identity(db);
        assert.equal(await queue(db, id), 53);
        assert.equal(await queue(db, id), 53);
        assert.equal((await read(db, id)).counts.skipped, 1);
        await db.exec('reset role');
        assert.equal(
          Number(
            await scalar(
              db,
              "select count(*) result from public.audit_events where entity_type='email_announcements' and entity_id=$1",
              [id],
            ),
          ),
          1,
        );
      },
    );
    await scenario(
      'leases exclude concurrent claims and reject old or expired acknowledgements',
      async () => {
        await identity(db);
        const id = await prepare(db);
        await queue(db, id);
        const rows = await claim(db);
        assert.equal(rows.length, 10);
        assert.ok(rows.every((r) => r.campaign_id === id));
        const second = await claim(db);
        assert.ok(second.every((r) => !rows.some((first) => first.user_id === r.user_id)));
        const row = rows[0];
        const finish = (token, failure = false) =>
          scalar(db, 'select public.finish_email_announcement($1,$2,$3,$4,$5) result', [
            id,
            row.user_id,
            token,
            'provider-id',
            failure,
          ]);
        assert.equal(await finish(randomUUID()), false);
        assert.equal(await finish(row.lease_token), true);
        assert.equal(await finish(row.lease_token), false);
        await db.exec('reset role');
        await db.query(
          "update private.email_announcement_recipients set lease_until=now()-interval '1 second' where campaign_id=$1 and user_id=$2",
          [id, rows[1].user_id],
        );
        await db.exec('set role service_role');
        assert.equal(
          await scalar(db, 'select public.finish_email_announcement($1,$2,$3,$4,false) result', [
            id,
            rows[1].user_id,
            rows[1].lease_token,
            'old',
          ]),
          false,
        );
      },
    );
    await scenario(
      'dispatch skips changed addresses and deactivated accounts after queueing',
      async () => {
        await identity(db);
        const id = await prepare(db);
        await queue(db, id);
        await db.exec('reset role');
        await db.query('update auth.users set email=$2 where id=$1', [
          employee,
          'new-address@example.invalid',
        ]);
        await db.query(
          "update public.organization_memberships set status='inactive',deactivated_at=now() where user_id=$1",
          [user(5)],
        );
        await claim(db);
        await identity(db);
        assert.equal((await read(db, id)).counts.skipped, 2);
      },
    );
    await scenario(
      'provider failures back off and retries stop at the attempt/window limit',
      async () => {
        await identity(db);
        const id = await prepare(db);
        await queue(db, id);
        const [row] = await claim(db);
        assert.equal(
          await scalar(db, 'select public.finish_email_announcement($1,$2,$3,null,true) result', [
            id,
            row.user_id,
            row.lease_token,
          ]),
          true,
        );
        await db.exec('reset role');
        const pending = (
          await db.query(
            'select * from private.email_announcement_recipients where campaign_id=$1 and user_id=$2',
            [id, row.user_id],
          )
        ).rows[0];
        assert.equal(pending.status, 'pending');
        assert.ok(new Date(pending.available_at) > new Date());
        await db.query(
          "update private.email_announcements set queued_at=now()-interval '24 hours' where id=$1",
          [id],
        );
        assert.deepEqual(await claim(db), []);
        await identity(db);
        assert.equal((await read(db, id)).counts.failed, 54);
      },
    );
    await scenario(
      'each company can prepare its own general announcement without sharing recipients',
      async () => {
        await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [
          user(56),
          'other-company@example.invalid',
        ]);
        await db.query(
          "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'end_user')",
          [foreignOrg, user(56)],
        );
        await identity(db, foreign);
        const id = await scalar(
          db,
          'select public.prepare_email_announcement($1,$2,$3,$4) result',
          [
            foreignOrg,
            randomUUID(),
            'Company office hours',
            'The office closes early this Friday.',
          ],
        );
        const own = await scalar(db, 'select public.read_email_announcements($1,$2) result', [
          foreignOrg,
          id,
        ]);
        assert.equal(own.counts.total, 2);
        assert.equal(own.campaign.subject, 'Company office hours');
        assert.ok(own.recipients.some((r) => r.user_id === user(56)));
        assert.ok(own.recipients.some((r) => r.user_id === foreign));
        await identity(db);
        assert.equal(await read(db, id), null);
      },
    );
    await scenario('empty eligible audiences cannot create a sendable draft', async () => {
      await db.query(
        'update auth.users set email_confirmed_at=null where id in(select user_id from public.organization_memberships where organization_id=$1)',
        [org],
      );
      await identity(db);
      await denied(db, () => prepare(db), 'PT422');
    });
    await scenario(
      'specific recipients are validated and cannot expand across companies or on retries',
      async () => {
        await identity(db);
        const token = randomUUID();
        const selected = [admin, staff, employee];
        const prepareSelected = (members) =>
          scalar(db, 'select public.prepare_email_announcement($1,$2,$3,$4,$5) result', [
            org,
            token,
            'Company announcement',
            'An announcement for selected members.',
            members,
          ]);
        await prepareSelected(selected);
        const review = await read(db, token);
        assert.equal(review.counts.total, 3);
        assert.deepEqual(review.recipients.map((r) => r.user_id).sort(), selected.sort());
        assert.equal(review.selection.length, 3);
        assert.equal(await prepareSelected([...selected].reverse()), token);
        await denied(db, () => prepareSelected(null), 'PT409');
        for (const members of [[foreign], [user(1)], [], [admin, admin]]) {
          await denied(
            db,
            () =>
              scalar(db, 'select public.prepare_email_announcement($1,$2,$3,$4,$5) result', [
                org,
                randomUUID(),
                'Selected people',
                'Message to selected people.',
                members,
              ]),
            members.length === 0 || members[0] === members[1] ? '22023' : 'PT422',
          );
        }
        assert.equal(await queue(db, token), 3);
        const rows = await claim(db);
        assert.deepEqual(rows.map((r) => r.user_id).sort(), selected.sort());
      },
    );
    await scenario(
      'recipient search is eligible, literal, bounded and administrator-only',
      async () => {
        await identity(db);
        const search = (query = '', page = 1) =>
          scalar(db, 'select public.email_announcement_choices($1,$2,$3) result', [
            org,
            query,
            page,
          ]);
        const first = await search();
        assert.equal(first.total, 54);
        assert.equal(first.rows.length, 50);
        assert.equal((await search('', 2)).rows.length, 4);
        assert.equal((await search('%')).total, 0);
        await identity(db, staff);
        await denied(db, () => search(), '42501');
      },
    );
    await scenario('MFA and revoked sessions remain mandatory for admin commands', async () => {
      await db.query(
        "insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",
        [admin],
      );
      await identity(db);
      await denied(db, () => prepare(db), '42501');
      await identity(db, admin, 'aal2');
      const id = await prepare(db);
      assert.ok(id);
      await scalar(db, 'select public.revoke_app_session() result');
      await denied(db, () => queue(db, id), '42501');
    });
  } finally {
    await db.close();
  }
});
