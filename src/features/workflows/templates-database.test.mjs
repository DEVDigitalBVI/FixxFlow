import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { existingTableColumns } from '../../../tests/helpers/preserved-rows.mjs';

const org = '20000000-0000-0000-0000-000000000401',
  admin = '10000000-0000-0000-0000-000000000401',
  owner = '10000000-0000-0000-0000-000000000403',
  employee = '10000000-0000-0000-0000-000000000404',
  outsider = '10000000-0000-0000-0000-000000000402',
  approver = '10000000-0000-0000-0000-000000000405',
  backup = '10000000-0000-0000-0000-000000000406';
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
const definition = () => ({
  schema_version: 1,
  name: 'Firewall maintenance',
  kind: 'maintenance',
  description: 'Follow the approved change procedure',
  steps: [
    {
      id: randomUUID(),
      title: 'Check connectivity',
      instructions: 'Record the baseline',
      assignee: 'owner',
      due_minutes: 60,
      approval_required: false,
      approval_minutes: 30,
    },
    {
      id: randomUUID(),
      title: 'Switch the standby route',
      instructions: 'Verify the vendor route before failover',
      assignee: 'backup',
      due_minutes: 120,
      approval_required: true,
      approval_minutes: 30,
    },
  ],
  communication: {
    guidance: 'Share the maintenance window and the next update time.',
    group_names: ['Leadership', 'Operations'],
    next_update_minutes: 45,
  },
  escalation: { enabled: true, acknowledgement_minutes: 15, overdue_minutes: 5 },
});
test('company workflow templates publish immutable versions and apply procedures atomically to ordinary tickets', async (t) => {
  const db = await migratedPostgres();
  try {
    await fixtures(db);
    await db.exec('begin');
    await identity(db, admin);
    const template = randomUUID(),
      def = definition();
    const manage = async (operation, revision, payload = {}, id = template) =>
      (
        await db.query('select public.manage_workflow_template($1,$2,$3,$4,$5) rev', [
          org,
          id,
          revision,
          operation,
          payload,
        ])
      ).rows[0].rev;
    let templateRev = await manage('save', 0, { definition: def });
    await t.test(
      'draft administration and validation reject malformed definitions and unauthorized writes',
      async () => {
        await identity(db, owner);
        assert.equal((await db.query('select * from public.workflow_templates')).rows.length, 0);
        assert.equal(
          (await db.query('select * from public.workflow_template_drafts')).rows.length,
          0,
        );
        await denied(
          db,
          () => manage('publish', templateRev, { change_note: 'Not allowed' }),
          /denied/,
        );
        await identity(db, admin);
        for (const invalid of [
          { ...def, schema_version: 2 },
          { ...def, steps: [] },
          { ...def, steps: [def.steps[0], def.steps[0]] },
          { ...def, steps: [{ ...def.steps[0], due_minutes: 0 }] },
          { ...def, communication: { ...def.communication, group_names: ['Ops', 'ops'] } },
          { ...def, escalation: { ...def.escalation, acknowledgement_minutes: '30' } },
        ])
          await denied(
            db,
            () => manage('save', templateRev, { definition: invalid }),
            /Invalid|unique|1–20|minutes|Unknown/,
          );
        await denied(
          db,
          () => manage('publish', templateRev + 1, { change_note: 'Wrong revision' }),
          /changed/,
        );
        templateRev = await manage('publish', templateRev, {
          change_note: 'Approved maintenance procedure',
        });
        await denied(
          db,
          () => db.query("update public.workflow_template_versions set definition='{}'"),
          /permission denied/,
        );
      },
    );
    const ticket = (
      await db.query('select public.submit_support_request($1,$2,$3,$4) id', [
        org,
        randomUUID(),
        'ticket',
        {
          requester_id: employee,
          title: 'Planned firewall maintenance',
          description: 'Prepare the network change',
          priority: 'normal',
          routing_mode: 'automatic',
        },
      ])
    ).rows[0].id;
    const token = randomUUID(),
      staff = { owner_id: owner, backup_id: backup, approver_id: approver };
    const apply = async (version = 1, key = token, payload = staff, id = template) =>
      (
        await db.query('select public.apply_workflow_template($1,$2,$3,$4,$5,$6,$7) id', [
          org,
          ticket,
          id,
          version,
          key,
          1,
          payload,
        ])
      ).rows[0].id;
    await t.test(
      'maintenance reuses all response features without an incident classification or automatic stakeholder sends',
      async () => {
        await identity(db, owner);
        assert.equal(await apply(), token);
        const ticketRow = (await db.query('select * from public.tickets where id=$1', [ticket]))
          .rows[0];
        assert.equal(ticketRow.ticket_type, 'support');
        assert.equal(ticketRow.status, 'new');
        assert.equal(ticketRow.priority, 'normal');
        assert.equal((await db.query('select * from public.ticket_incidents')).rows.length, 0);
        const context = (await db.query('select * from public.ticket_workflows')).rows[0];
        assert.equal(context.kind, 'maintenance');
        assert.equal(context.owner_id, owner);
        const run = (await db.query('select * from public.ticket_workflow_applications')).rows[0];
        assert.deepEqual(run.definition_snapshot, def);
        assert.equal(run.template_version, 1);
        const steps = (
          await db.query('select * from public.incident_steps order by procedure_position')
        ).rows;
        assert.deepEqual(
          steps.map((s) => s.title),
          def.steps.map((s) => s.title),
        );
        assert.deepEqual(
          steps.map((s) => s.assignee_id),
          [owner, backup],
        );
        assert.deepEqual(
          steps.map((s) => s.id),
          run.step_ids,
        );
        assert.equal(Date.parse(steps[0].due_at) - Date.parse(run.applied_at), 60 * 60000);
        assert.equal(Date.parse(steps[1].due_at) - Date.parse(run.applied_at), 120 * 60000);
        const approval = (await db.query('select * from public.incident_approvals')).rows[0];
        assert.equal(approval.step_id, steps[1].id);
        assert.equal(approval.approver_id, approver);
        assert.equal(approval.requested_by, owner);
        assert.equal(approval.step_snapshot.title, steps[1].title);
        assert.equal(
          (await db.query('select backup_owner_id from public.incident_escalation_policies'))
            .rows[0].backup_owner_id,
          backup,
        );
        const plan = (await db.query('select * from public.incident_communication_plans')).rows[0];
        assert.equal(Date.parse(plan.next_update_at) - Date.parse(run.applied_at), 45 * 60000);
        assert.equal(
          (await db.query('select * from public.incident_stakeholder_groups')).rows.length,
          2,
        );
        assert.equal(
          (await db.query('select * from public.incident_stakeholder_members')).rows.length,
          0,
        );
        assert.equal((await db.query('select * from public.incident_bulletins')).rows.length, 0);
        await denied(
          db,
          () => db.query('update public.ticket_workflows set owner_id=$1', [approver]),
          /permission denied/,
        );
      },
    );
    await t.test(
      'lost-response retries and repeated application never duplicate work or overwrite progress',
      async () => {
        const before = (await db.query('select count(*) count from public.notifications')).rows[0]
          .count;
        assert.equal(await apply(), token);
        assert.equal(await apply(1, randomUUID()), token);
        assert.equal((await db.query('select * from public.incident_steps')).rows.length, 2);
        assert.equal(
          (await db.query('select count(*) count from public.notifications')).rows[0].count,
          before,
        );
        const first = (
          await db.query('select * from public.incident_steps order by procedure_position')
        ).rows[0];
        await db.query('select public.change_incident_step($1,$2,$3,$4,$5,$6)', [
          org,
          ticket,
          first.id,
          first.revision,
          'acknowledge',
          {},
        ]);
        await db.query('select public.change_incident_step($1,$2,$3,$4,$5,$6)', [
          org,
          ticket,
          first.id,
          first.revision + 1,
          'complete',
          {},
        ]);
        assert.equal(await apply(), token);
        assert.ok(
          (await db.query('select completed_at from public.incident_steps where id=$1', [first.id]))
            .rows[0].completed_at,
        );
      },
    );
    await t.test(
      'required maintenance decisions gate completion and procedure origins cannot be forged',
      async () => {
        const second = (
          await db.query('select * from public.incident_steps order by procedure_position')
        ).rows[1];
        await denied(
          db,
          () =>
            db.query(
              'insert into public.incident_steps(id,organization_id,ticket_id,title,instructions,assignee_id,application_id,procedure_position) values($1,$2,$3,$4,$5,$6,$7,0)',
              [
                randomUUID(),
                org,
                ticket,
                'Forged procedure step',
                'Not part of the published application',
                owner,
                token,
              ],
            ),
          /origin unavailable/,
        );
        await identity(db, backup);
        await db.query('select public.change_incident_step($1,$2,$3,$4,$5,$6)', [
          org,
          ticket,
          second.id,
          second.revision,
          'acknowledge',
          {},
        ]);
        await denied(
          db,
          () =>
            db.query('select public.change_incident_step($1,$2,$3,$4,$5,$6)', [
              org,
              ticket,
              second.id,
              second.revision + 1,
              'complete',
              {},
            ]),
          /Approval required/,
        );
        const approval = (await db.query('select * from public.incident_approvals')).rows[0];
        await identity(db, approver);
        await db.query('select public.manage_incident_control($1,$2,$3,$4,$5,$6)', [
          org,
          ticket,
          approval.id,
          approval.revision,
          'approve',
          { note: 'The standby route is ready' },
        ]);
        await identity(db, backup);
        await db.query('select public.change_incident_step($1,$2,$3,$4,$5,$6)', [
          org,
          ticket,
          second.id,
          second.revision + 1,
          'complete',
          {},
        ]);
        await identity(db, owner);
      },
    );
    await t.test(
      'publishing updates, archiving and restoration preserve pinned versions and staff privacy',
      async () => {
        await identity(db, admin);
        const edited = {
          ...def,
          name: 'Revised firewall maintenance',
          steps: def.steps.map((s, i) => ({
            ...s,
            title: i ? 'Switch the approved new route' : s.title,
          })),
        };
        templateRev = await manage('save', templateRev, { definition: edited });
        // The catalog retains published metadata until this saved draft is published.
        assert.equal(
          (await db.query('select name from public.workflow_templates')).rows[0].name,
          def.name,
        );
        templateRev = await manage('publish', templateRev, {
          change_note: 'Updated route instructions',
        });
        assert.equal(
          (await db.query('select * from public.workflow_template_versions')).rows.length,
          2,
        );
        const run = (await db.query('select * from public.ticket_workflow_applications')).rows[0];
        assert.equal(run.definition_snapshot.steps[1].title, def.steps[1].title);
        assert.equal(run.template_version, 1);
        await identity(db, owner);
        await denied(db, () => apply(2, randomUUID()), /already applied/);
        await identity(db, approver);
        await denied(
          db,
          () => apply(2, randomUUID(), { ...staff, approver_id: admin }),
          /already applied/,
        );
        await identity(db, admin);
        templateRev = await manage('archive', templateRev);
        await identity(db, owner);
        assert.equal((await db.query('select * from public.workflow_templates')).rows.length, 0);
        assert.equal(
          (await db.query('select * from public.workflow_template_versions')).rows.length,
          0,
        );
        assert.equal(
          (await db.query('select * from public.ticket_workflow_applications')).rows.length,
          1,
        );
        assert.equal(await apply(), token);
        for (const user of [employee, outsider]) {
          await identity(db, user);
          for (const table of [
            'workflow_templates',
            'workflow_template_drafts',
            'workflow_template_versions',
            'ticket_workflows',
            'ticket_workflow_applications',
            'incident_steps',
            'incident_approvals',
          ])
            assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0, table);
          await denied(db, () => apply(), /denied/);
        }
        await identity(db, admin);
        templateRev = await manage('restore', templateRev);
      },
    );
    await t.test(
      'a late group-capacity failure rolls back receipts, steps, approvals and notification outbox together',
      async () => {
        await identity(db, owner);
        for (let i = 2; i < 20; i++)
          await db.query('select public.manage_incident_communication($1,$2,$3,0,$4,$5)', [
            org,
            ticket,
            randomUUID(),
            'save_group',
            { name: `Existing group ${i}` },
          ]);
        await identity(db, admin);
        const second = randomUUID(),
          another = {
            ...def,
            name: 'Additional procedure',
            kind: 'procedure',
            communication: { ...def.communication, group_names: ['A new group beyond capacity'] },
          };
        let rev = await manage('save', 0, { definition: another }, second);
        await manage('publish', rev, { change_note: 'Additional response work' }, second);
        await identity(db, owner);
        const counts = async () =>
          (
            await db.query(
              'select (select count(*) from public.incident_steps) steps,(select count(*) from public.incident_approvals) approvals,(select count(*) from public.ticket_workflow_applications) applications,(select count(*) from public.notifications) notifications',
            )
          ).rows[0];
        const before = await counts();
        await denied(db, () => apply(1, randomUUID(), staff, second), /20 active groups/);
        assert.deepEqual(await counts(), before);
      },
    );
    await t.test(
      'maintenance supports explicit backup takeover while keeping ordinary ticket semantics',
      async () => {
        await identity(db, backup);
        await db.query('select public.manage_incident_control($1,$2,$2,1,$3,$4)', [
          org,
          ticket,
          'take_over',
          {},
        ]);
        assert.equal(
          (await db.query('select owner_id from public.ticket_workflows')).rows[0].owner_id,
          backup,
        );
        assert.equal(
          (await db.query('select ticket_type from public.tickets where id=$1', [ticket])).rows[0]
            .ticket_type,
          'support',
        );
        assert.equal((await db.query('select * from public.ticket_incidents')).rows.length, 0);
      },
    );
    await t.test(
      'shared scheduling escalates maintenance communication without incident metadata',
      async () => {
        const plan = (await db.query('select * from public.incident_communication_plans')).rows[0];
        await db.query('select public.manage_incident_communication($1,$2,$2,$3,$4,$5)', [
          org,
          ticket,
          plan.revision,
          'save_plan',
          { owner_id: owner, next_update_at: '2020-01-01T00:00:00Z' },
        ]);
        await db.exec('reset role');
        await db.exec('set role service_role');
        assert.equal(
          (await db.query('select public.enqueue_incident_escalations() count')).rows[0].count,
          1,
        );
        await identity(db, admin);
        assert.equal(
          (await db.query('select reason from public.incident_escalations')).rows[0].reason,
          'communication_overdue',
        );
      },
    );
    await t.test(
      'enrolled MFA applies to template administration, application and reads',
      async () => {
        await db.exec('reset role');
        await db.query(
          "insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",
          [admin],
        );
        await identity(db, admin);
        assert.equal((await db.query('select * from public.workflow_templates')).rows.length, 0);
        await denied(db, () => manage('archive', templateRev), /denied/);
        await denied(db, () => apply(), /denied/);
        await identity(db, admin, 'aal2');
        assert.ok((await db.query('select * from public.workflow_templates')).rows.length > 0);
      },
    );
  } finally {
    await db.exec('rollback');
    await db.close();
  }
});

test('template upgrade preserves existing incident data, approvals, approved communications and outbox history', async () => {
  let before, ticket;
  const tables = [
    'public.tickets',
    'public.ticket_incidents',
    'public.incident_steps',
    'public.incident_step_history',
    'public.incident_approvals',
    'public.incident_approval_history',
    'public.incident_escalation_policies',
    'public.incident_communication_plans',
    'public.incident_stakeholder_groups',
    'public.incident_stakeholder_members',
    'public.incident_update_drafts',
    'public.incident_bulletins',
    'public.incident_bulletin_recipients',
    'public.notifications',
    'private.notification_email_outbox',
  ];
  const snapshot = async (db) => {
    const result = {};
    for (const table of tables) {
      result[table] = (await db.query(`select * from ${table}`)).rows
        .map((row) => {
          if (table === 'public.incident_steps') {
            delete row.application_id;
            delete row.procedure_position;
          }
          if (table === 'private.notification_email_outbox') delete row.ticket_name;
          return row;
        })
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return result;
  };
  const db = await migratedPostgres({
    throughMigration: '20261025203000_inbound_email.sql', // Later SLA policy intentionally converts unfinished deadlines.
    beforeMigration: async (db, name) => {
      if (!name.endsWith('_reusable_workflow_templates.sql')) return;
      await fixtures(db);
      await identity(db, admin);
      ticket = (
        await db.query('select public.submit_incident_ticket($1,$2,$3) id', [
          org,
          randomUUID(),
          {
            requester_id: employee,
            title: 'Existing incident',
            description: 'Existing conversation context',
            priority: 'normal',
            routing_mode: 'automatic',
            incident: {
              severity: 'major',
              business_impact: 'Existing private impact',
              owner_id: owner,
              affected_services: ['Network'],
              affected_locations: ['Office'],
            },
          },
        ])
      ).rows[0].id;
      const step = randomUUID();
      await db.query('select public.change_incident_step($1,$2,$3,0,$4,$5)', [
        org,
        ticket,
        step,
        'add',
        {
          title: 'Existing response work',
          instructions: 'Preserve original instructions',
          assignee_id: owner,
          due_at: null,
        },
      ]);
      await db.query('select public.manage_incident_control($1,$2,$2,0,$3,$4)', [
        org,
        ticket,
        'save_policy',
        {
          backup_owner_id: backup,
          enabled: true,
          acknowledgement_minutes: 30,
          overdue_minutes: 15,
        },
      ]);
      await db.query('select public.manage_incident_control($1,$2,$3,0,$4,$5)', [
        org,
        ticket,
        randomUUID(),
        'request_approval',
        {
          title: 'Existing decision request',
          description: 'Preserve its saved work snapshot',
          approver_id: approver,
          backup_approver_id: backup,
          step_id: step,
          due_at: '2099-01-01T00:00:00Z',
        },
      ]);
      const group = randomUUID(),
        draft = randomUUID();
      await db.query('select public.manage_incident_communication($1,$2,$3,0,$4,$5)', [
        org,
        ticket,
        group,
        'save_group',
        { name: 'Existing stakeholders' },
      ]);
      await db.query('select public.manage_incident_communication($1,$2,$3,1,$4,$5)', [
        org,
        ticket,
        group,
        'add_member',
        { user_id: employee },
      ]);
      await db.query('select public.manage_incident_communication($1,$2,$3,0,$4,$5)', [
        org,
        ticket,
        draft,
        'save_draft',
        {
          title: 'Existing approved update',
          body: 'Preserve the approved public message.',
          group_ids: [group],
          next_update_at: '2099-01-01T00:00:00Z',
        },
      ]);
      await db.query('select public.manage_incident_communication($1,$2,$3,1,$4,$5)', [
        org,
        ticket,
        draft,
        'publish',
        {},
      ]);
      await db.exec('reset role');
      before = await snapshot(db);
    },
  });
  try {
    assert.deepEqual(existingTableColumns(await snapshot(db), before), before);
    const workflow = (await db.query('select * from public.ticket_workflows')).rows[0];
    assert.equal(workflow.ticket_id, ticket);
    assert.equal(workflow.owner_id, owner);
    assert.equal(workflow.kind, 'incident');
    assert.equal(
      (await db.query('select * from public.ticket_workflow_applications')).rows.length,
      0,
    );
    await identity(db, admin);
    const template = randomUUID(),
      def = definition();
    await db.query('select public.manage_workflow_template($1,$2,0,$3,$4)', [
      org,
      template,
      'save',
      { definition: def },
    ]);
    await db.query('select public.manage_workflow_template($1,$2,1,$3,$4)', [
      org,
      template,
      'publish',
      { change_note: 'Maintenance can also support an incident' },
    ]);
    const revision = (await db.query('select revision from public.tickets where id=$1', [ticket]))
      .rows[0].revision;
    await db.query('select public.apply_workflow_template($1,$2,$3,1,$4,$5,$6)', [
      org,
      ticket,
      template,
      randomUUID(),
      revision,
      { owner_id: owner, backup_id: backup, approver_id: approver },
    ]);
    assert.equal(
      (await db.query('select kind from public.ticket_workflows')).rows[0].kind,
      'incident',
    );
    assert.equal(
      (await db.query('select severity from public.ticket_incidents')).rows[0].severity,
      'major',
    );
  } finally {
    await db.close();
  }
});

test('known foreign template IDs, inactive assignments and stale ticket revisions cannot create procedures', async () => {
  const db = await migratedPostgres();
  try {
    await fixtures(db);
    await db.exec('begin');
    await identity(db, outsider);
    const orgB = '20000000-0000-0000-0000-000000000402',
      foreign = randomUUID(),
      d = definition();
    await db.query('select public.manage_workflow_template($1,$2,0,$3,$4)', [
      orgB,
      foreign,
      'save',
      { definition: d },
    ]);
    await db.query('select public.manage_workflow_template($1,$2,1,$3,$4)', [
      orgB,
      foreign,
      'publish',
      { change_note: 'Other company procedure' },
    ]);
    await identity(db, admin);
    await denied(
      db,
      () =>
        db.query('select public.manage_workflow_template($1,$2,0,$3,$4)', [
          org,
          foreign,
          'save',
          { definition: { ...d, name: 'Forged overwrite' } },
        ]),
      /duplicate key/,
    );
    const template = randomUUID();
    await db.query('select public.manage_workflow_template($1,$2,0,$3,$4)', [
      org,
      template,
      'save',
      { definition: d },
    ]);
    await db.query('select public.manage_workflow_template($1,$2,1,$3,$4)', [
      org,
      template,
      'publish',
      { change_note: 'Company procedure' },
    ]);
    const ticket = (
      await db.query('select public.submit_support_request($1,$2,$3,$4) id', [
        org,
        randomUUID(),
        'ticket',
        {
          requester_id: employee,
          title: 'Company maintenance',
          description: 'Prepare the maintenance window',
          priority: 'normal',
          routing_mode: 'automatic',
        },
      ])
    ).rows[0].id;
    await identity(db, admin);
    const incidentTemplate = randomUUID();
    await db.query('select public.manage_workflow_template($1,$2,0,$3,$4)', [
      org,
      incidentTemplate,
      'save',
      { definition: { ...d, kind: 'incident' } },
    ]);
    await db.query('select public.manage_workflow_template($1,$2,1,$3,$4)', [
      org,
      incidentTemplate,
      'publish',
      { change_note: 'Incident-specific response procedure' },
    ]);
    await identity(db, owner);
    const apply = (id = template, rev = 1, overrides = {}) =>
      db.query('select public.apply_workflow_template($1,$2,$3,1,$4,$5,$6)', [
        org,
        ticket,
        id,
        randomUUID(),
        rev,
        { owner_id: owner, backup_id: backup, approver_id: approver, ...overrides },
      ]);
    await denied(db, () => apply(incidentTemplate), /Declare an incident/);
    await denied(db, () => apply(foreign), /unavailable/);
    await denied(db, () => apply(template, 99), /Ticket changed/);
    await denied(db, () => apply(template, 1, { owner_id: approver }), /different coordinator/);
    await denied(db, () => apply(template, 1, { approver_id: owner }), /another active/);
    await denied(db, () => apply(template, 1, { backup_id: outsider }), /different active backup/);
    await db.exec('reset role');
    await db.query(
      "update public.organization_memberships set status='inactive',deactivated_at=now() where organization_id=$1 and user_id=$2",
      [org, approver],
    );
    await identity(db, owner);
    await denied(db, () => apply(), /active company approver/);
    assert.equal((await db.query('select * from public.ticket_workflows')).rows.length, 0);
    assert.equal(
      (await db.query('select * from public.ticket_workflow_applications')).rows.length,
      0,
    );
    await identity(db, outsider);
    assert.equal(
      (await db.query('select name from public.workflow_templates where id=$1', [foreign])).rows[0]
        .name,
      d.name,
    );
  } finally {
    await db.close();
  }
});
