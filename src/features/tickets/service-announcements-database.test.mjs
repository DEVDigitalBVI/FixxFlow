import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  owner = '10000000-0000-0000-0000-000000000403',
  employee = '10000000-0000-0000-0000-000000000404',
  foreign = '10000000-0000-0000-0000-000000000402',
  author = '10000000-0000-0000-0000-000000000407';
async function identity(db, id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated', aal: 'aal1' }),
  ]);
  await db.exec('set role authenticated');
}
async function denied(db, fn, code) {
  await db.exec('savepoint rejected');
  try {
    await assert.rejects(fn, code ? { code } : undefined);
  } finally {
    await db.exec('rollback to rejected;release savepoint rejected');
  }
}
async function one(db, sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
test('workspace announcement publication protects drafts, authority, history and lifecycle', async (t) => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.query("insert into auth.users(id,email) values($1,'notice-author@example.invalid')", [
      author,
    ]);
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'technician')",
      [org, author],
    );
    await db.exec('update auth.users set email_confirmed_at=now()');
    const ticket = (
      await one(
        db,
        "insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,'SECRET internal incident','PRIVATE diagnosis') returning id",
        [org, employee],
      )
    ).id;
    await db.query(
      "insert into public.ticket_workflows(ticket_id,organization_id,kind,owner_id) values($1,$2,'procedure',$3)",
      [ticket, org, owner],
    );
    const change = async (op, revision, payload = {}, organization = org) =>
      (
        await one(db, 'select public.manage_service_announcement($1,$2,$3,$4,$5) rev', [
          organization,
          ticket,
          revision,
          op,
          payload,
        ])
      ).rev;
    const scenario = async (name, fn) =>
      t.test(name, async () => {
        await db.exec('begin');
        try {
          await fn();
        } finally {
          await db.exec('rollback;reset role');
        }
      });
    const save = async () => {
      await identity(db, author);
      return change('save', 0, {
        title: 'Email service interrupted',
        body: 'IT is working with the provider. Please check back here.',
      });
    };
    await scenario(
      'staff save drafts, only coordinator or admin approves, and employee sees only approved content',
      async () => {
        assert.equal(await save(), 1);
        await identity(db, author);
        await denied(db, () => change('publish', 1, { confirm: 'yes' }), '42501');
        await identity(db, employee);
        assert.equal(
          (await db.query('select * from public.service_announcement_drafts')).rows.length,
          0,
        );
        assert.equal((await db.query('select * from public.service_announcements')).rows.length, 0);
        await identity(db, owner);
        await denied(db, () => change('publish', 1));
        await change('publish', 1, { confirm: 'yes' });
        await identity(db, employee);
        const rows = (await db.query('select * from public.service_announcements')).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].title, 'Email service interrupted');
        assert.doesNotMatch(JSON.stringify(rows), /SECRET|PRIVATE/);
        assert.equal((await db.query('select * from public.ticket_workflows')).rows.length, 0);
      },
    );
    await scenario(
      'saving replacement keeps current published snapshot and stale approval is rejected',
      async () => {
        await save();
        await identity(db, admin);
        await change('publish', 1, { confirm: 'yes' });
        await change('save', 1, { title: 'Updated notice', body: 'This is an UNAPPROVED edit' });
        await denied(db, () => change('publish', 1, { confirm: 'yes' }), 'PT409');
        await identity(db, employee);
        assert.doesNotMatch(
          JSON.stringify((await db.query('select * from public.service_announcements')).rows),
          /UNAPPROVED/,
        );
        await identity(db, admin);
        await change('publish', 2, { confirm: 'yes' });
        await identity(db, employee);
        const rows = (await db.query('select * from public.service_announcements')).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].title, 'Updated notice');
        await identity(db, admin);
        assert.equal((await db.query('select * from public.service_announcements')).rows.length, 2);
      },
    );
    await scenario(
      'approval retries are idempotent, audited and queue one email per active member',
      async () => {
        await db.exec('reset role');
        const before = await one(
          db,
          'select (select count(*) from public.notifications) notices,(select count(*) from private.notification_email_outbox) emails,(select count(*) from public.audit_events) audit',
        );
        await save();
        await identity(db, owner);
        await change('publish', 1, { confirm: 'yes' });
        await change('publish', 1, { confirm: 'yes' });
        await db.exec('reset role');
        const after = await one(
          db,
          'select (select count(*) from public.notifications) notices,(select count(*) from private.notification_email_outbox) emails,(select count(*) from public.audit_events) audit',
        );
        assert.equal(Number(after.notices) - Number(before.notices), 4);
        assert.equal(Number(after.emails) - Number(before.emails), 4);
        assert.equal(Number(after.audit) - Number(before.audit), 2);
        assert.equal((await db.query('select * from public.service_announcements')).rows.length, 1);
      },
    );
    await scenario(
      'employee, foreign, anonymous, service and direct-table writes cannot bypass publication',
      async () => {
        await save();
        for (const id of [employee, foreign]) {
          await identity(db, id);
          await denied(db, () => change('publish', 1, { confirm: 'yes' }), '42501');
          assert.equal(
            (await db.query('select * from public.service_announcement_drafts')).rows.length,
            0,
          );
        }
        await identity(db, admin);
        await denied(
          db,
          () => change('publish', 1, { confirm: 'yes' }, '20000000-0000-0000-0000-000000000402'),
          '42501',
        );
        await denied(
          db,
          () => db.exec("update public.service_announcement_drafts set body='FORGED'"),
          '42501',
        );
        await denied(
          db,
          () =>
            db.exec(
              'insert into public.service_announcements(organization_id,ticket_id,title,body,draft_revision,published_by) select organization_id,ticket_id,title,body,revision,updated_by from public.service_announcement_drafts',
            ),
          '42501',
        );
        for (const role of ['anon', 'service_role']) {
          await db.exec(`reset role;set role ${role}`);
          await denied(db, () => change('publish', 1, { confirm: 'yes' }), '42501');
        }
      },
    );
    await scenario(
      'MFA and active membership protect published notices and mutations',
      async () => {
        await save();
        await identity(db, admin);
        await change('publish', 1, { confirm: 'yes' });
        await db.exec('reset role');
        await db.query(
          "insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified'),(gen_random_uuid(),$2,'totp','verified')",
          [admin, employee],
        );
        await identity(db, admin);
        await denied(db, () => change('withdraw', 1), '42501');
        await identity(db, employee);
        assert.equal((await db.query('select * from public.service_announcements')).rows.length, 0);
        await db.exec('reset role');
        await db.query(
          "update public.organization_memberships set status='inactive',deactivated_at=now() where organization_id=$1 and user_id=$2",
          [org, employee],
        );
        await identity(db, employee);
        assert.equal((await db.query('select * from public.service_announcements')).rows.length, 0);
      },
    );
    await scenario(
      'manual withdrawal retains history and requires a new saved revision to publish again',
      async () => {
        await save();
        await identity(db, admin);
        await change('publish', 1, { confirm: 'yes' });
        await change('withdraw', 1);
        await identity(db, employee);
        assert.equal((await db.query('select * from public.service_announcements')).rows.length, 0);
        await identity(db, admin);
        await denied(db, () => change('publish', 1, { confirm: 'yes' }));
        assert.equal((await db.query('select * from public.service_announcements')).rows.length, 1);
      },
    );
    await scenario('resolution hides the notice and reopening never republishes it', async () => {
      await save();
      await identity(db, admin);
      await change('publish', 1, { confirm: 'yes' });
      await db.query("update public.tickets set status='resolved' where id=$1", [ticket]);
      await denied(db, () =>
        change('save', 1, { title: 'Still down', body: 'This must not be published' }),
      );
      await identity(db, employee);
      assert.equal((await db.query('select * from public.service_announcements')).rows.length, 0);
      await identity(db, admin);
      await db.query("update public.tickets set status='open' where id=$1", [ticket]);
      await identity(db, employee);
      assert.equal((await db.query('select * from public.service_announcements')).rows.length, 0);
    });
  } finally {
    await db.close();
  }
});
