import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  assigned = '10000000-0000-0000-0000-000000000403',
  employee = '10000000-0000-0000-0000-000000000404',
  foreign = '10000000-0000-0000-0000-000000000402',
  other = '10000000-0000-0000-0000-000000000408',
  inactive = '10000000-0000-0000-0000-000000000409';
async function identity(db, id, aal = 'aal1') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated', aal }),
  ]);
  await db.exec('set role authenticated');
}
async function one(db, sql, args = []) {
  return (await db.query(sql, args)).rows[0];
}
async function denied(db, fn, code) {
  await db.exec('savepoint rejected');
  try {
    await assert.rejects(fn, code ? { code } : undefined);
  } finally {
    await db.exec('rollback to rejected;release savepoint rejected');
  }
}
test('one-step employee announcements publish atomically and email active members safely', async (t) => {
  const db = await migratedPostgres();
  try {
    await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,'other-tech@example.invalid',now()),($2,'inactive@example.invalid',now())",
      [other, inactive],
    );
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role,status,deactivated_at) values($1,$2,'technician','active',null),($1,$3,'end_user','inactive',now())",
      [org, other, inactive],
    );
    await db.exec('update auth.users set email_confirmed_at=now()');
    await db.exec(
      "insert into auth.users(id,email) values('10000000-0000-0000-0000-000000000410','unverified@example.invalid');insert into public.organization_memberships(organization_id,user_id,role) values('20000000-0000-0000-0000-000000000401','10000000-0000-0000-0000-000000000410','end_user')",
    );
    const ticket = (
      await one(
        db,
        "insert into public.tickets(organization_id,requester_id,assigned_technician_id,title,description) values($1,$2,$3,'SECRET ticket name','INTERNAL diagnosis') returning id",
        [org, employee, assigned],
      )
    ).id;
    const publish = async (
      revision = 0,
      key = randomUUID(),
      title = 'Email service interrupted',
      body = 'IT is working with the provider.',
    ) =>
      (
        await one(db, 'select public.publish_employee_announcement($1,$2,$3,$4,$5,$6) result', [
          org,
          ticket,
          revision,
          title,
          body,
          key,
        ])
      ).result;
    const scenario = async (name, fn) =>
      t.test(name, async () => {
        await db.exec('begin');
        try {
          await fn();
        } finally {
          await db.exec('rollback;reset role');
        }
      });
    await scenario(
      'assignee publishes without a workflow and every active member gets one queued email',
      async () => {
        await identity(db, assigned);
        const key = randomUUID(),
          result = await publish(0, key);
        assert.equal(result.revision, 1);
        assert.equal(result.recipients, 4);
        assert.deepEqual(await publish(0, key), result);
        await db.exec('reset role');
        const rows = (
          await db.query(
            'select n.recipient_id,n.ticket_id,n.service_announcement_id,q.status from public.notifications n join private.notification_email_outbox q on q.notification_id=n.id where n.service_announcement_id=$1',
            [result.id],
          )
        ).rows;
        assert.deepEqual(
          rows.map((r) => r.recipient_id).sort(),
          [admin, assigned, employee, other].sort(),
        );
        assert.ok(rows.every((r) => r.status === 'pending' && r.ticket_id === null));
        assert.equal(
          (await db.query('select * from public.ticket_workflows where ticket_id=$1', [ticket]))
            .rows.length,
          0,
        );
        await identity(db, employee);
        const notices = (await db.query('select * from public.service_announcements')).rows;
        assert.equal(notices.length, 1);
        assert.doesNotMatch(JSON.stringify(notices), /SECRET|INTERNAL/);
        assert.equal(
          (await db.query('select * from public.service_announcement_drafts')).rows.length,
          0,
        );
        assert.equal(
          (
            await db.query('select * from public.notifications where service_announcement_id=$1', [
              result.id,
            ])
          ).rows.length,
          1,
        );
      },
    );
    await scenario(
      'non-owner staff, employee, another organization, anon and service cannot publish',
      async () => {
        for (const id of [other, employee, foreign]) {
          await identity(db, id);
          await denied(db, () => publish(), '42501');
        }
        for (const role of ['anon', 'service_role']) {
          await db.exec(`reset role;set role ${role}`);
          await denied(db, () => publish(), '42501');
        }
        await db.exec('reset role');
        assert.equal(
          (
            await db.query('select * from public.service_announcement_drafts where ticket_id=$1', [
              ticket,
            ])
          ).rows.length,
          0,
        );
      },
    );
    await scenario(
      'coordinator and admin are allowed; prior assignee loses permission on reassignment',
      async () => {
        await db.exec('reset role');
        await db.query(
          "insert into public.ticket_workflows(ticket_id,organization_id,kind,owner_id) values($1,$2,'procedure',$3)",
          [ticket, org, other],
        );
        await identity(db, other);
        await publish();
        await identity(db, admin);
        await db.query('update public.tickets set assigned_technician_id=$1 where id=$2', [
          other,
          ticket,
        ]);
        await publish(1);
        await identity(db, assigned);
        await denied(db, () => publish(2), '42501');
      },
    );
    await scenario(
      'stale edits and changed receipt payloads cannot replace or resend announcements',
      async () => {
        await identity(db, assigned);
        const key = randomUUID(),
          first = await publish(0, key);
        await denied(db, () => publish(0, randomUUID()), 'PT409');
        await denied(db, () => publish(0, key, 'Changed title'), 'PT409');
        const second = await publish(1, randomUUID(), 'Email update', 'Service is being restored.');
        assert.notEqual(first.id, second.id);
        assert.equal(second.recipients, 4);
        await db.exec('reset role');
        assert.equal(
          Number(
            (
              await one(
                db,
                'select count(*) n from public.service_announcements where ticket_id=$1',
                [ticket],
              )
            ).n,
          ),
          2,
        );
      },
    );
    await scenario(
      'read notices still email; deactivated members and withdrawn notices are skipped before dispatch',
      async () => {
        await identity(db, assigned);
        const publication = await publish();
        await identity(db, employee);
        await db.query(
          'update public.notifications set read_at=now() where service_announcement_id=$1',
          [publication.id],
        );
        await db.exec('reset role');
        await db.query(
          "update public.organization_memberships set status='inactive',deactivated_at=now() where user_id=$1 and organization_id=$2",
          [other, org],
        );
        await db.exec('set role service_role');
        const claimed = (
          await db.query('select * from public.claim_notification_emails(20)')
        ).rows.filter((r) => r.service_announcement_id === publication.id);
        assert.equal(claimed.length, 3);
        assert.ok(claimed.some((r) => r.recipient_email === 'events-requester@example.invalid'));
        assert.ok(
          claimed.every(
            (r) =>
              r.approved_body === 'Status: Investigating\n\nIT is working with the provider.' &&
              r.ticket_id === null,
          ),
        );
        assert.doesNotMatch(JSON.stringify(claimed), /SECRET|INTERNAL/);
      },
    );
    await scenario(
      'resolution cancels unsent announcement mail and removes the home notice without republishing on reopen',
      async () => {
        await identity(db, assigned);
        const publication = await publish();
        await db.query("update public.tickets set status='resolved' where id=$1", [ticket]);
        await db.exec('reset role;set role service_role');
        const rows = (await db.query('select * from public.claim_notification_emails(20)')).rows;
        assert.ok(rows.every((r) => r.service_announcement_id !== publication.id));
        await db.exec('reset role');
        assert.equal(
          Number(
            (
              await one(
                db,
                "select count(*) n from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.service_announcement_id=$1 and q.status='skipped'",
                [publication.id],
              )
            ).n,
          ),
          4,
        );
        await identity(db, employee);
        assert.equal((await db.query('select * from public.service_announcements')).rows.length, 0);
      },
    );
    await scenario(
      'MFA remains required and unauthorized publication rolls back the entered draft',
      async () => {
        await db.exec('reset role');
        await db.query(
          "insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",
          [assigned],
        );
        await identity(db, assigned);
        await denied(db, () => publish(), '42501');
        await identity(db, assigned, 'aal2');
        assert.ok((await publish()).id);
      },
    );
  } finally {
    await db.close();
  }
});
