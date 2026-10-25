import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

test('ticket intake alerts all company admins and ownership emails survive reading and self assignment', async () => {
  const db = await migratedPostgres();
  try {
    const org = randomUUID(),
      foreignOrg = randomUUID();
    const [admin, secondAdmin, inactiveAdmin, foreignAdmin, employee, technician, unverified] =
      Array.from({ length: 7 }, () => randomUUID());
    await db.query(
      "insert into public.organizations(id,name,slug) values($1,'Intake','intake-alerts'),($2,'Other','other-intake')",
      [org, foreignOrg],
    );
    for (const id of [
      admin,
      secondAdmin,
      inactiveAdmin,
      foreignAdmin,
      employee,
      technician,
      unverified,
    ])
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)', [
        id,
        `${id}@example.test`,
        id === unverified ? null : new Date().toISOString(),
      ]);
    for (const [id, role, status, company] of [
      [admin, 'administrator', 'active', org],
      [secondAdmin, 'administrator', 'active', org],
      [inactiveAdmin, 'administrator', 'inactive', org],
      [foreignAdmin, 'administrator', 'active', foreignOrg],
      [employee, 'end_user', 'active', org],
      [technician, 'technician', 'active', org],
      [unverified, 'administrator', 'active', org],
    ])
      await db.query(
        "insert into public.organization_memberships(organization_id,user_id,role,status,deactivated_at) values($1,$2,$3,$4,case when $4::public.membership_status='inactive' then now() else null end)",
        [company, id, role, status],
      );
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: employee }),
    ]);
    const ticket = randomUUID();
    await db.query(
      "insert into public.tickets(id,organization_id,requester_id,title,description) values($1,$2,$3,'Intake test','Private employee description')",
      [ticket, org, employee],
    );
    const notices = (
      await db.query('select * from public.notifications where ticket_id=$1', [ticket])
    ).rows;
    assert.deepEqual(
      notices.map((n) => n.recipient_id).sort(),
      [admin, secondAdmin, unverified].sort(),
    );
    assert.ok(
      notices.every(
        (n) => n.kind === 'ticket_created' && n.staff_only && !n.title.includes('Private'),
      ),
    );
    assert.equal(
      (await db.query('select * from private.notification_email_outbox')).rows.length,
      3,
    );
    assert.equal(
      (
        await db.query(
          'select count(*)::int count from private.notification_email_outbox where available_at>now()',
        )
      ).rows[0].count,
      0,
      'intake mail is immediately eligible',
    );
    // Self-assignment is still a responsibility change and must send email.
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: technician }),
    ]);
    await db.query('update public.tickets set assigned_technician_id=$1 where id=$2', [
      technician,
      ticket,
    ]);
    const assigned = (
      await db.query(
        "select * from public.notifications where ticket_id=$1 and kind='ticket_assigned'",
        [ticket],
      )
    ).rows;
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].recipient_id, technician);
    assert.equal(
      (
        await db.query(
          'select available_at<=now() ready from private.notification_email_outbox where notification_id=$1',
          [assigned[0].id],
        )
      ).rows[0].ready,
      true,
    );
    await db.query("update public.tickets set title='Edited title' where id=$1", [ticket]);
    assert.equal(
      (await db.query('select * from public.notifications where ticket_id=$1', [ticket])).rows
        .length,
      4,
    );
    // Intake/assignment email remains due after in-app read. Former staff and
    // unverified email addresses remain ineligible regardless of event kind.
    await db.query(
      "update public.organization_memberships set status='inactive',deactivated_at=now() where organization_id=$1 and user_id=$2",
      [org, secondAdmin],
    );
    await db.exec(
      'update public.notifications set read_at=now(); update private.notification_email_outbox set available_at=now();',
    );
    const claimed = (await db.query('select * from public.claim_notification_emails(20)')).rows;
    assert.ok(
      claimed.every((n) => n.title.endsWith(' — Intake test · Priority: Normal')),
      'email uses the queued name even after ticket rename',
    );
    assert.deepEqual(
      claimed.map((n) => n.recipient_email).sort(),
      [admin, technician].map((id) => `${id}@example.test`).sort(),
    );
    assert.equal(
      (await db.query("select * from private.notification_email_outbox where status='skipped'"))
        .rows.length,
      2,
    );
    assert.equal(
      (await db.query('select * from public.claim_notification_emails(20)')).rows.length,
      0,
    );
    for (const n of claimed)
      assert.equal(
        (
          await db.query('select public.finish_notification_email($1,$2,$3,null) ok', [
            n.notification_id,
            n.lease_token,
            'mock-provider',
          ])
        ).rows[0].ok,
        true,
      );
    // Reassignment reaches the new owner; unchanged ownership is silent.
    await db.query('update public.tickets set assigned_technician_id=$1 where id=$2', [
      admin,
      ticket,
    ]);
    assert.equal(
      (
        await db.query(
          "select * from public.notifications where ticket_id=$1 and recipient_id=$2 and kind='ticket_reassigned'",
          [ticket, admin],
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.notifications where ticket_id=$1 and kind='ticket_created'",
          [ticket],
        )
      ).rows.length,
      3,
    );
    const reassigned = (
      await db.query(
        "select q.available_at<=now() ready from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.ticket_id=$1 and n.kind='ticket_reassigned'",
        [ticket],
      )
    ).rows;
    assert.ok(reassigned.length > 0 && reassigned.every((n) => n.ready));
    // Routine replies still wait a minute and retain coalescing.
    await db.query(
      "select private.enqueue_notification($1,$2,$3,$4,null,'ticket_response','Reply',false,'routine-1')",
      [org, employee, admin, ticket],
    );
    await db.query(
      "select private.enqueue_notification($1,$2,$3,$4,null,'ticket_response','Reply',false,'routine-2')",
      [org, employee, admin, ticket],
    );
    const routine = (
      await db.query(
        "select q.available_at>now() delayed from private.notification_email_outbox q join public.notifications n on n.id=q.notification_id where n.ticket_id=$1 and n.kind='ticket_response'",
        [ticket],
      )
    ).rows;
    assert.equal(routine.length, 1);
    assert.equal(routine[0].delayed, true);
    const immediate = (await db.query('select * from public.claim_notification_emails(20)')).rows;
    assert.ok(immediate.length > 0);
    assert.ok(immediate.every((n) => !n.title.startsWith('Reply')));
    const retry = immediate[0];
    await db.query("select public.finish_notification_email($1,$2,null,'Temporary failure')", [
      retry.notification_id,
      retry.lease_token,
    ]);
    assert.equal(
      (
        await db.query(
          'select available_at>now() delayed from private.notification_email_outbox where notification_id=$1',
          [retry.notification_id],
        )
      ).rows[0].delayed,
      true,
      'failure still schedules retry backoff',
    );
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated','public.claim_notification_emails(integer)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});
