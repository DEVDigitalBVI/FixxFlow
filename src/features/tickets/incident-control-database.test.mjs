import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  owner = '10000000-0000-0000-0000-000000000403',
  employee = '10000000-0000-0000-0000-000000000404',
  outsider = '10000000-0000-0000-0000-000000000402',
  backup = '10000000-0000-0000-0000-000000000405',
  approver = '10000000-0000-0000-0000-000000000406';
const identity = async (db, id, aal = 'aal1') => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, role: 'authenticated', aal }),
  ]);
  await db.exec('set role authenticated');
};
async function denied(db, run, pattern) {
  await db.exec('savepoint denied');
  try {
    await assert.rejects(run, pattern);
  } finally {
    await db.exec('rollback to savepoint denied; release savepoint denied');
  }
}
async function fixtures(db) {
  await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
    backup,
    'backup@example.invalid',
    approver,
    'approver@example.invalid',
  ]);
  await db.query(
    "insert into public.organization_memberships(organization_id,user_id,role) values($1,$2,'technician'),($1,$3,'technician')",
    [org, backup, approver],
  );
}
async function incident(db) {
  await identity(db, admin);
  return (
    await db.query('select public.submit_incident_ticket($1,$2,$3) id', [
      org,
      randomUUID(),
      {
        requester_id: employee,
        title: 'Office outage',
        description: 'Several teams affected',
        priority: 'normal',
        routing_mode: 'automatic',
        incident: {
          severity: 'major',
          business_impact: 'Internal service disruption',
          owner_id: owner,
          affected_services: [],
          affected_locations: [],
        },
      },
    ])
  ).rows[0].id;
}
test('escalation and approvals enforce ownership, independent decisions, fresh work and durable notifications', async (t) => {
  const db = await migratedPostgres();
  try {
    await fixtures(db);
    await db.exec('begin');
    const ticket = await incident(db),
      step = randomUUID();
    const control = async (operation, target, revision, payload = {}) =>
      (
        await db.query('select public.manage_incident_control($1,$2,$3,$4,$5,$6) rev', [
          org,
          ticket,
          target,
          revision,
          operation,
          payload,
        ])
      ).rows[0].rev;
    const stepPayload = {
      title: 'Fail over network connection',
      instructions: 'Use the standby connection',
      assignee_id: owner,
      due_at: '2020-01-01T00:00:00Z',
    };
    const change = async (op, rev, p = stepPayload) =>
      (
        await db.query('select public.change_incident_step($1,$2,$3,$4,$5,$6) rev', [
          org,
          ticket,
          step,
          rev,
          op,
          p,
        ])
      ).rows[0].rev;
    let policyRev = await control('save_policy', ticket, 0, {
      backup_owner_id: backup,
      enabled: true,
      acknowledgement_minutes: 1,
      overdue_minutes: 0,
    });
    let stepRev = await change('add', 0);
    await t.test(
      'assignment notifications and escalation are staff-only and once per episode',
      async () => {
        await identity(db, owner);
        assert.equal(
          (await db.query("select * from public.notifications where kind='incident_step_assigned'"))
            .rows.length,
          1,
        );
        await db.exec('reset role');
        await db.exec(
          "alter table public.incident_steps disable trigger user; update public.incident_steps set assignment_started_at=now()-interval '2 minutes'; alter table public.incident_steps enable trigger user;",
        );
        await db.exec('set role service_role');
        assert.equal(
          (await db.query('select public.enqueue_incident_escalations() count')).rows[0].count,
          2,
        );
        assert.equal(
          (await db.query('select public.enqueue_incident_escalations() count')).rows[0].count,
          0,
        );
        await identity(db, backup);
        assert.equal(
          (await db.query("select * from public.notifications where kind='incident_escalation'"))
            .rows.length,
          2,
        );
        assert.deepEqual(
          (
            await db.query('select reason from public.incident_escalations order by reason')
          ).rows.map((r) => r.reason),
          ['acknowledgement_missed', 'step_overdue'],
        );
        await denied(
          db,
          () => db.query('select public.enqueue_incident_escalations()'),
          /permission denied/,
        );
      },
    );
    const request = {
      title: 'Approve network failover',
      description: 'Permit use of the standby circuit',
      approver_id: approver,
      backup_approver_id: backup,
      step_id: step,
      due_at: '2099-01-01T00:00:00Z',
    };
    let requestId = randomUUID(),
      requestRev;
    await t.test(
      'approval gates the current work and acknowledgement does not invalidate it',
      async () => {
        await identity(db, owner);
        await denied(
          db,
          () => control('request_approval', randomUUID(), 0, { ...request, approver_id: owner }),
          /another active/,
        );
        requestRev = await control('request_approval', requestId, 0, request);
        assert.equal(await control('request_approval', requestId, 0, request), requestRev);
        stepRev = await change('acknowledge', stepRev);
        await denied(db, () => change('complete', stepRev), /Approval required/);
        await denied(
          db,
          () => control('approve', requestId, requestRev, { note: 'Self approval attempt' }),
          /designated approver/,
        );
        await identity(db, backup);
        await denied(
          db,
          () => control('approve', requestId, requestRev, { note: 'Too early' }),
          /designated approver/,
        );
        await identity(db, approver);
        await denied(
          db,
          () => control('approve', requestId, requestRev + 1, { note: 'Wrong revision' }),
          /changed/,
        );
        requestRev = await control('approve', requestId, requestRev, {
          note: 'Standby circuit is ready',
        });
        await denied(
          db,
          () => db.query("update public.incident_approvals set status='approved'"),
          /permission denied/,
        );
        await identity(db, owner);
        stepRev = await change('complete', stepRev);
      },
    );
    await t.test(
      'reopened or edited work needs fresh approval and replacement preserves earlier decisions',
      async () => {
        await identity(db, owner);
        stepRev = await change('reopen', stepRev);
        stepRev = await change('acknowledge', stepRev);
        await denied(db, () => change('complete', stepRev), /Approval required/);
        await denied(
          db,
          () =>
            db.query(
              'update public.incident_steps set work_version=1,completed_at=now(),revision=revision+1 where id=$1',
              [step],
            ),
          /Approval required/,
        );
        const replacement = randomUUID();
        let replacementRev = await control('request_approval', replacement, 0, request);
        const old = (
          await db.query('select * from public.incident_approvals where id=$1', [requestId])
        ).rows[0];
        assert.equal(old.status, 'approved');
        assert.equal(old.superseded_by, replacement);
        stepRev = await change('edit', stepRev, {
          ...stepPayload,
          instructions: 'Use the revised standby route',
        });
        await identity(db, approver);
        await denied(
          db,
          () => control('approve', replacement, replacementRev, { note: 'Old details' }),
          /Step changed/,
        );
        await identity(db, owner);
        requestId = randomUUID();
        requestRev = await control('request_approval', requestId, 0, request);
        await identity(db, approver);
        requestRev = await control('reject', requestId, requestRev, {
          note: 'Standby route needs verification',
        });
        await identity(db, owner);
        await denied(db, () => change('complete', stepRev), /Approval required/);
        const final = randomUUID();
        let finalRev = await control('request_approval', final, 0, request);
        finalRev = await control('cancel_approval', final, finalRev, {
          note: 'Use the existing approved manual procedure instead',
        });
        assert.ok(finalRev > 1);
        stepRev = await change('complete', stepRev, {
          ...stepPayload,
          instructions: 'Use the revised standby route',
        });
        const history = (
          await db.query('select action from public.incident_approval_history order by id')
        ).rows.map((r) => r.action);
        assert.ok(history.includes('approved'));
        assert.ok(history.includes('superseded'));
        assert.ok(history.includes('rejected'));
        assert.ok(history.includes('cancelled'));
        await denied(
          db,
          () => db.query('delete from public.incident_approval_history'),
          /permission denied/,
        );
      },
    );
    await t.test(
      'backup approvers decide after the deadline and overdue communications escalate once',
      async () => {
        await identity(db, owner);
        const overdue = randomUUID();
        let rev = await control('request_approval', overdue, 0, {
          ...request,
          step_id: null,
          due_at: '2020-01-01T00:00:00Z',
        });
        await db.query('select public.manage_incident_communication($1,$2,$2,0,$3,$4)', [
          org,
          ticket,
          'save_plan',
          { owner_id: owner, next_update_at: '2020-01-01T00:00:00Z' },
        ]);
        await db.exec('reset role');
        await db.exec('set role service_role');
        assert.equal(
          (await db.query('select public.enqueue_incident_escalations() count')).rows[0].count,
          2,
        );
        assert.equal(
          (await db.query('select public.enqueue_incident_escalations() count')).rows[0].count,
          0,
        );
        await identity(db, backup);
        rev = await control('approve', overdue, rev, { note: 'Reviewed after primary deadline' });
        assert.ok(rev > 1);
      },
    );
    await t.test(
      'backup takeover is explicit, audited and independent of assignment and communication ownership',
      async () => {
        await identity(db, approver);
        await denied(
          db,
          () =>
            control('save_policy', ticket, policyRev, {
              backup_owner_id: approver,
              enabled: true,
              acknowledgement_minutes: 1,
              overdue_minutes: 0,
            }),
          /Only the coordinator/,
        );
        await denied(db, () => control('take_over', ticket, policyRev), /current backup owner/);
        await identity(db, backup);
        policyRev = await control('take_over', ticket, policyRev);
        assert.equal(
          (
            await db.query('select owner_id from public.ticket_incidents where ticket_id=$1', [
              ticket,
            ])
          ).rows[0].owner_id,
          backup,
        );
        assert.equal(
          (await db.query('select backup_owner_id from public.incident_escalation_policies'))
            .rows[0].backup_owner_id,
          owner,
        );
        assert.equal(
          (await db.query('select owner_id from public.incident_communication_plans')).rows[0]
            .owner_id,
          owner,
        );
        assert.equal(
          (await db.query('select assignee_id from public.incident_steps')).rows[0].assignee_id,
          owner,
        );
        assert.equal(
          (
            await db.query(
              "select * from public.incident_control_history where action='incident_taken_over'",
            )
          ).rows.length,
          1,
        );
        await denied(db, () => control('take_over', ticket, policyRev - 1), /current backup owner/);
      },
    );
    await t.test(
      'employee, cross-tenant, MFA, foreign approval IDs and closed-incident boundaries hold',
      async () => {
        for (const user of [employee, outsider]) {
          await identity(db, user);
          for (const table of [
            'incident_approvals',
            'incident_approval_history',
            'incident_escalation_policies',
            'incident_escalations',
            'incident_control_history',
          ])
            assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0, table);
          await denied(
            db,
            () => control('approve', requestId, requestRev, { note: 'Forged decision' }),
            /denied/,
          );
        }
        await identity(db, admin);
        await denied(
          db,
          () => control('approve', randomUUID(), 1, { note: 'Foreign id' }),
          /unavailable/,
        );
        await db.query("update public.tickets set status='closed' where id=$1", [ticket]);
        await control('save_policy', ticket, policyRev, {
          backup_owner_id: owner,
          enabled: true,
          acknowledgement_minutes: 2,
          overdue_minutes: 0,
        });
        await db.exec('reset role');
        await db.exec('set role service_role');
        assert.equal(
          (await db.query('select public.enqueue_incident_escalations() count')).rows[0].count,
          0,
        );
        await db.exec('reset role');
        await db.query(
          "insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",
          [admin],
        );
        await identity(db, admin);
        assert.equal((await db.query('select * from public.incident_approvals')).rows.length, 0);
        await denied(db, () => control('save_policy', ticket, policyRev, {}), /denied/);
        await identity(db, admin, 'aal2');
        assert.ok((await db.query('select * from public.incident_approvals')).rows.length > 0);
      },
    );
  } finally {
    await db.exec('rollback');
    await db.close();
  }
});

test('upgrading existing response steps preserves their content, revisions and audit chronology', async () => {
  let before, ticket;
  const db = await migratedPostgres({
    beforeMigration: async (db, name) => {
      if (!name.endsWith('_incident_escalation_and_approvals.sql')) return;
      await fixtures(db);
      ticket = await incident(db);
      await db.query('select public.change_incident_step($1,$2,$3,0,$4,$5)', [
        org,
        ticket,
        randomUUID(),
        'add',
        {
          title: 'Existing response step',
          instructions: 'Keep this audit history',
          assignee_id: owner,
          due_at: null,
        },
      ]);
      before = (await db.query('select * from public.incident_steps')).rows[0];
      await db.exec('reset role');
    },
  });
  try {
    await identity(db, admin);
    const after = (await db.query('select * from public.incident_steps')).rows[0];
    const {
      work_version,
      assignment_token,
      assignment_started_at,
      application_id,
      procedure_position,
      ...original
    } = after;
    assert.equal(application_id, null);
    assert.equal(procedure_position, null);
    assert.deepEqual(original, before);
    assert.equal(work_version, 1);
    assert.ok(assignment_token);
    assert.equal(assignment_started_at, null);
    assert.equal((await db.query('select * from public.incident_step_history')).rows.length, 1);
    assert.equal((await db.query('select * from public.incident_control_history')).rows.length, 0);
  } finally {
    await db.close();
  }
});

test('escalation falls back to active company administrators when designated owners leave', async () => {
  const db = await migratedPostgres();
  try {
    await fixtures(db);
    const ticket = await incident(db);
    await db.query('select public.manage_incident_control($1,$2,$2,0,$3,$4)', [
      org,
      ticket,
      'save_policy',
      { backup_owner_id: backup, enabled: true, acknowledgement_minutes: 30, overdue_minutes: 0 },
    ]);
    await db.query('select public.change_incident_step($1,$2,$3,0,$4,$5)', [
      org,
      ticket,
      randomUUID(),
      'add',
      {
        title: 'Overdue response step',
        instructions: 'Call the vendor',
        assignee_id: approver,
        due_at: '2020-01-01T00:00:00Z',
      },
    ]);
    await db.exec('reset role');
    await db.query(
      "update public.organization_memberships set status='inactive',deactivated_at=now() where organization_id=$1 and user_id=any($2)",
      [org, [owner, backup]],
    );
    await db.exec('set role service_role');
    assert.equal(
      (await db.query('select public.enqueue_incident_escalations() count')).rows[0].count,
      1,
    );
    await identity(db, admin);
    assert.deepEqual(
      (await db.query('select recipient_ids from public.incident_escalations')).rows[0]
        .recipient_ids,
      [admin],
    );
  } finally {
    await db.close();
  }
});
