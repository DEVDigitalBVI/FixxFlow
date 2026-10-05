import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { load } from '../../../tests/helpers/load-module.mjs';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { action, condition, definition, group, evaluateConditions, registry, validateEvent } from '../../../tests/fixtures/automation.mjs';

const id = (prefix, suffix = '401') => `${prefix}0000000-0000-0000-0000-000000000${suffix}`;
const org = id(2), otherOrg = id(2, '402'), admin = id(1), otherAdmin = id(1, '402'), worker = id(1, '403'), employee = id(1, '404'), team = id(4), category = id(5);
async function identity(db, actor = admin, role = 'authenticated', aal = 'aal1') {
  assert.ok(['authenticated', 'service_role', 'anon'].includes(role));
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role, aal })]);
}
const owner = db => db.exec('reset role');
const service = db => identity(db, null, 'service_role');
async function denied(db, sql, params = [], code = '42501') {
  await db.exec('savepoint denial');
  try { await assert.rejects(db.query(sql, params), { code }); }
  finally { await db.exec('rollback to savepoint denial; release savepoint denial'); }
}
async function createRule(db, actions = [action()], conditions = group(), tenant = org, trigger = 'ticket.created') {
  await identity(db, tenant === org ? admin : otherAdmin);
  const created = (await db.query('select * from public.create_automation_rule($1,$2)', [tenant, definition({ actions, conditions, trigger: { type: trigger, configuration: {} } })])).rows[0];
  return (await db.query('select * from public.set_automation_rule_enabled($1,$2,$3,true)', [tenant, created.id, created.version])).rows[0];
}
async function activate(db, value = true) { await owner(db); await db.query('select private.set_automation_processing($1)', [value]); await new Promise(resolve => setTimeout(resolve, 2)); }
async function ticket(db, tenant = org, fields = {}) {
  await identity(db, tenant === org ? admin : otherAdmin);
  return (await db.query('insert into public.tickets(organization_id,requester_id,title,description,category_id,subcategory_id) values($1,$2,$3,$4,$5,$6) returning *', [tenant, tenant === org ? employee : otherAdmin, 'Network request', 'PRIVATE DESCRIPTION', fields.category ?? null, fields.subcategory ?? null])).rows[0];
}
async function deliveryFor(db, ticketId, type = 'ticket.created') {
  await service(db);
  const claimed = (await db.query('select * from public.claim_domain_events(100,900)')).rows;
  const delivery = claimed.find(item => item.event.entityId === ticketId && item.event.type === type);
  assert.ok(delivery, `missing delivery ${ticketId} ${type}`); return delivery;
}
const begin = async (db, delivery, rule) => (await db.query('select * from public.begin_automation_execution($1,$2,$3,$4)', [delivery.delivery_id, delivery.lease_token, rule.id, rule.version])).rows[0];
const command = (execution, action) => ({ organizationId: execution.organization_id, entityId: execution.entity_id, action });
const execute = async (db, context, position = 0, override) => (await db.query('select * from public.execute_automation_ticket_step($1,$2,$3)', [context.execution.id, context.delivery.lease_token, override ?? command(context.execution, context.rule.definition.actions[position])])).rows[0];
async function ready(db, actions, conditions) {
  const rule = await createRule(db, actions, conditions); await activate(db);
  const target = await ticket(db); const delivery = await deliveryFor(db, target.id);
  const execution = await begin(db, delivery, rule); return { rule, target, delivery, execution };
}
async function rows(db, table, field, value) {
  await owner(db); return (await db.query(`select * from ${table} where ${field}=$1`, [value])).rows;
}

test('Stage 4 execution authority and trusted ticket commands on clean migrations', async t => {
  const db = await migratedPostgres();
  const scenario = async (name, run) => t.test(name, async () => {
    await db.exec('begin');
    try { await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8')); await run(); }
    finally { await db.exec('rollback'); }
  });
  try {
    await scenario('assignment, team, priority/SLA, resolution, category and note run in order with atomic receipts', async () => {
      const actions = [action('assign_technician', { technicianId: worker }, 0), action('assign_team', { teamId: team }, 1), action('set_priority', { priority: 'critical' }, 2), action('set_status', { status: 'resolved' }, 3), action('set_category', { categoryId: category }, 4), action('add_internal_note', { body: 'PRIVATE AUTOMATION NOTE' }, 5)];
      const context = await ready(db, actions, group(condition('priority', 'equals', 'normal'), condition('status', 'equals', 'new', 'status-condition')));
      assert.equal(context.execution.organization_id, org); assert.equal(context.execution.rule_version, context.rule.version);
      assert.deepEqual(context.execution.conditions.map(result => result.status), ['passed', 'passed']);
      for (let i = 0; i < actions.length; i++) {
        const step = await execute(db, context, i);
        assert.equal(step.status, 'succeeded', JSON.stringify(step)); assert.equal(step.position, i); assert.equal(step.attempts, 1);
        assert.equal(step.action_id, actions[i].id); assert.ok(step.idempotency_key); assert.ok(step.completed_at);
        assert.deepEqual(await execute(db, context, i), step);
      }
      const [final] = await rows(db, 'public.tickets', 'id', context.target.id);
      assert.equal(final.assigned_technician_id, worker); assert.equal(final.team_id, team); assert.equal(final.routing_mode, 'manual');
      assert.equal(final.priority, 'critical'); assert.equal(final.status, 'resolved'); assert.ok(final.resolved_at); assert.equal(final.category_id, category);
      assert.notEqual(final.response_sla_due_at, context.target.response_sla_due_at); assert.notEqual(final.resolution_sla_due_at, context.target.resolution_sla_due_at);
      assert.equal(final.revision, 6); assert.equal(final.first_response_at, null);
      const [execution] = await rows(db, 'public.automation_executions', 'id', context.execution.id);
      assert.equal(execution.status, 'succeeded'); assert.equal(execution.actions_attempted, 6); assert.equal(execution.expected_entity_revision, 6);
      const [note] = await rows(db, 'public.ticket_messages', 'ticket_id', final.id);
      assert.equal(note.author_id, null); assert.equal(note.author_type, 'automation'); assert.equal(note.automation_execution_id, execution.id); assert.equal(note.automation_name, context.rule.name);
      assert.equal(note.automation_step_id, (await rows(db, 'public.automation_execution_steps', 'id', note.automation_step_id))[0].id);
      await service(db);
      await denied(db, "update public.ticket_messages set body='Altered receipt',automation_name='Impersonation' where id=$1", [note.id]);
      await denied(db, 'delete from public.ticket_messages where id=$1', [note.id]);
      await owner(db);
      const events = (await db.query('select private.domain_event_envelope(e) as event from private.domain_events e where automation_execution_id=$1', [execution.id])).rows.map(row => row.event);
      assert.ok(events.length >= 5);
      for (const event of events) {
        assert.equal(validateEvent(event).valid, true); assert.equal(event.actorType, 'automation'); assert.equal(event.actorId, null);
        assert.equal(event.automationExecutionId, execution.id); assert.equal(event.causationId, execution.event_id); assert.equal(event.correlationId, execution.correlation_id); assert.equal(event.depth, 1);
        assert.doesNotMatch(JSON.stringify(event), /PRIVATE/);
      }
      const history = await rows(db, 'public.ticket_activity', 'ticket_id', final.id);
      assert.ok(history.some(item => item.action === 'internal_note_added' && item.actor_id === null && item.details.automationName === context.rule.name));
      const audits = await rows(db, 'public.audit_events', 'entity_id', note.id);
      assert.equal(audits[0].actor_id, null); assert.equal(audits[0].actor_name, `Automation: ${context.rule.name}`); assert.doesNotMatch(JSON.stringify(audits), /PRIVATE AUTOMATION NOTE/);
      assert.ok((await rows(db, 'public.notifications', 'ticket_id', final.id)).length > 0);
      assert.equal((await db.query('select count(*)::int n from private.automation_command_contexts')).rows[0].n, 0);
    });
    await scenario('wrong organization, target, altered config/type/id/position, extra fields and order rejected', async () => {
      const context = await ready(db, [action(), action('set_status', { status: 'open' }, 1)]);
      const original = command(context.execution, context.rule.definition.actions[0]);
      for (const forged of [
        { ...original, organizationId: otherOrg }, { ...original, entityId: id(9) }, { ...original, extra: true },
        { ...original, action: { ...original.action, configuration: { priority: 'critical' } } },
        { ...original, action: { ...original.action, type: 'set_status' } },
        { ...original, action: { ...original.action, id: 'missing' } },
        { ...original, action: { ...original.action, position: 19 } },
      ]) await denied(db, 'select public.execute_automation_ticket_step($1,$2,$3)', [context.execution.id, context.delivery.lease_token, forged], '22023');
      await denied(db, 'select public.execute_automation_ticket_step($1,$2,$3)', [context.execution.id, context.delivery.lease_token, command(context.execution, context.rule.definition.actions[1])], '55000');
      await denied(db, 'select public.execute_automation_ticket_step($1,$2,$3)', [id(9), context.delivery.lease_token, original]);
      await denied(db, 'select public.execute_automation_ticket_step($1,$2,$3)', [context.execution.id, id(9), original]);
      assert.equal((await execute(db, context)).status, 'succeeded');
    });
    for (const [label, sql] of [
      ['inactive technician', "update public.organization_memberships set status='inactive',deactivated_at=clock_timestamp() where user_id=$1"],
      ['non-worker technician', "update public.organization_memberships set role='end_user' where user_id=$1"],
    ]) await scenario(`${label} fails current-reference validation and stops remaining actions`, async () => {
      const context = await ready(db, [action('assign_technician', { technicianId: worker }), action('set_priority', { priority: 'critical' }, 1)]);
      await owner(db); await db.query(sql, [worker]); await service(db);
      const failed = await execute(db, context); assert.equal(failed.status, 'failed'); assert.equal(failed.error_code, 'unavailable_reference');
      const later = await execute(db, context, 1); assert.equal(later.status, 'not_attempted'); assert.equal(later.attempts, 0); assert.equal(later.started_at, null);
      assert.equal((await rows(db, 'public.tickets', 'id', context.target.id))[0].priority, 'normal');
    });
    for (const [type, configuration] of [
      ['assign_technician', { technicianId: otherAdmin }], ['assign_team', { teamId: id(4, '402') }], ['set_category', { categoryId: id(5, '402') }],
    ]) await scenario(`cross-tenant ${type} cannot enter a definition or alter a pinned action`, async () => {
      await owner(db);
      await db.query('insert into public.teams(id,organization_id,name) values($1,$2,$3)', [id(4, '402'), otherOrg, 'Other team']);
      await db.query('insert into public.ticket_categories(id,organization_id,name) values($1,$2,$3)', [id(5, '402'), otherOrg, 'Other category']);
      await identity(db);
      await denied(db, 'select public.create_automation_rule($1,$2)', [org, definition({ actions: [action(type, configuration)], conditions: group() })], '22023');
      const context = await ready(db);
      await denied(db, 'select public.execute_automation_ticket_step($1,$2,$3)', [context.execution.id, context.delivery.lease_token, command(context.execution, action(type, configuration))], '22023');
    });
    for (const [type, configuration, table, target] of [
      ['assign_team', { teamId: team }, 'teams', team], ['set_category', { categoryId: category }, 'ticket_categories', category],
    ]) await scenario(`inactive ${type} reference rejected at execution`, async () => {
      const context = await ready(db, [action(type, configuration)]);
      await owner(db); await db.query(`update public.${table} set is_active=false where id=$1`, [target]); await service(db);
      assert.equal((await execute(db, context)).error_code, 'unavailable_reference');
    });
    await scenario('category change clears incompatible subcategory; invalid relationship remains protected', async () => {
      await owner(db);
      const secondCategory = (await db.query('insert into public.ticket_categories(organization_id,name) values($1,$2) returning id', [org, 'Another category'])).rows[0].id;
      const subcategory = (await db.query('insert into public.ticket_subcategories(organization_id,category_id,name) values($1,$2,$3) returning id', [org, category, 'Child'])).rows[0].id;
      const rule = await createRule(db, [action('set_category', { categoryId: secondCategory })]); await activate(db);
      const target = await ticket(db, org, { category, subcategory }); const delivery = await deliveryFor(db, target.id); const execution = await begin(db, delivery, rule);
      const context = { rule, delivery, execution };
      assert.equal((await execute(db, context)).status, 'succeeded');
      const [final] = await rows(db, 'public.tickets', 'id', target.id); assert.equal(final.category_id, secondCategory); assert.equal(final.subcategory_id, null); assert.equal(final.team_id, team);
      await identity(db); await denied(db, 'update public.tickets set subcategory_id=$2 where id=$1', [target.id, subcategory], '23503');
    });
    await scenario('human change after admission makes every action, including notes, stale', async () => {
      const context = await ready(db, [action('add_internal_note', { body: 'Should not appear' })]);
      await identity(db); await db.query("update public.tickets set title='New human context' where id=$1", [context.target.id]); await service(db);
      assert.equal((await execute(db, context)).error_code, 'stale_entity');
      assert.equal((await rows(db, 'public.ticket_messages', 'ticket_id', context.target.id)).length, 0);
    });
    await scenario('intervening human edit after one success produces partial completion; remaining steps unattempted', async () => {
      const context = await ready(db, [action(), action('set_status', { status: 'resolved' }, 1), action('add_internal_note', { body: 'Never' }, 2)]);
      assert.equal((await execute(db, context)).status, 'succeeded');
      await identity(db); await db.query("update public.tickets set status='on_hold' where id=$1", [context.target.id]); await service(db);
      assert.equal((await execute(db, context, 1)).error_code, 'stale_entity');
      assert.equal((await execute(db, context, 2)).status, 'not_attempted');
      const [execution] = await rows(db, 'public.automation_executions', 'id', context.execution.id); assert.equal(execution.status, 'partially_completed'); assert.equal(execution.actions_attempted, 2);
      assert.equal((await rows(db, 'public.tickets', 'id', context.target.id))[0].status, 'on_hold');
    });
    await scenario('failure writing a successful receipt rolls back mutation, events, history and notification', async () => {
      const context = await ready(db, [action(), action('set_status', { status: 'resolved' }, 1)]);
      await owner(db);
      const counts = async () => (await db.query(`select (select count(*) from private.domain_events) events,(select count(*) from public.ticket_activity) activity,(select count(*) from public.notifications) notifications`)).rows[0];
      const before = await counts();
      await db.exec("create function private.test_receipt_failure() returns trigger language plpgsql as $$ begin if new.status='succeeded' then raise exception 'SECRET SQL DETAIL'; end if; return new; end $$; create trigger test_receipt_failure before update on public.automation_execution_steps for each row execute function private.test_receipt_failure();");
      await service(db); const step = await execute(db, context); assert.equal(step.status, 'failed'); assert.equal(step.error_code, 'action_failed'); assert.doesNotMatch(JSON.stringify(step), /SECRET/);
      const [final] = await rows(db, 'public.tickets', 'id', context.target.id); assert.equal(final.priority, 'normal'); assert.equal(final.revision, 1); assert.deepEqual(await counts(), before);
      assert.equal((await db.query('select count(*)::int n from private.automation_command_contexts')).rows[0].n, 0);
      assert.equal((await rows(db, 'public.automation_execution_steps', 'execution_id', context.execution.id)).find(item => item.position === 1).status, 'not_attempted');
    });
    await scenario('transaction rollback removes successful note and receipt together; retried commit creates once', async () => {
      const context = await ready(db, [action('add_internal_note', { body: 'One note' })]);
      await db.exec('savepoint crash'); assert.equal((await execute(db, context)).status, 'succeeded'); await db.exec('rollback to savepoint crash');
      const completed = await execute(db, context); assert.equal(completed.status, 'succeeded'); assert.deepEqual(await execute(db, context), completed);
      assert.equal((await rows(db, 'public.ticket_messages', 'ticket_id', context.target.id)).length, 1);
    });
    await scenario('processing defaults off; event must follow activation, enablement and immutable version', async () => {
      const rule = await createRule(db); const target = await ticket(db); const delivery = await deliveryFor(db, target.id);
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [delivery.delivery_id, delivery.lease_token, rule.id, rule.version], '55000');
      await activate(db); await service(db);
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [delivery.delivery_id, delivery.lease_token, rule.id, rule.version], '55000');
      const fresh = await ticket(db); const freshDelivery = await deliveryFor(db, fresh.id);
      await identity(db);
      const updated = (await db.query('select * from public.update_automation_rule($1,$2,$3,$4)', [org, rule.id, rule.version, { ...rule.definition, name: 'New version' }])).rows[0];
      await service(db); await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [freshDelivery.delivery_id, freshDelivery.lease_token, updated.id, updated.version], '55000');
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [freshDelivery.delivery_id, freshDelivery.lease_token, rule.id, rule.version], '55000');
      const next = await ticket(db); const nextDelivery = await deliveryFor(db, next.id); assert.equal((await begin(db, nextDelivery, updated)).rule_version, updated.version);
      await identity(db);
      const disabled = (await db.query('select * from public.set_automation_rule_enabled($1,$2,$3,false)', [org, updated.id, updated.version])).rows[0];
      const disabledTarget = await ticket(db); const disabledDelivery = await deliveryFor(db, disabledTarget.id);
      await identity(db); const reenabled = (await db.query('select * from public.set_automation_rule_enabled($1,$2,$3,true)', [org, disabled.id, disabled.version])).rows[0];
      await service(db); await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [disabledDelivery.delivery_id, disabledDelivery.lease_token, reenabled.id, reenabled.version], '55000');
    });
    await scenario('timestamp-eligible event cannot observe an uncommitted version in its capture snapshot', async () => {
      const rule = await createRule(db); await activate(db);
      // Simulate a second transaction's snapshot while this rule transaction is
      // still in progress. This is a visibility predicate test, not concurrent I/O.
      await db.exec(`create function private.test_capture_visibility() returns trigger language plpgsql as $$ declare x bigint:=pg_current_xact_id()::text::bigint; begin new.capture_transaction:=(x+1)::text::xid8; new.capture_snapshot:=(x::text||':'||(x+2)::text||':'||x::text)::pg_snapshot; return new; end $$;
        create trigger test_capture_visibility before insert on private.domain_events for each row execute function private.test_capture_visibility();
        update private.automation_processing_state set activation_transaction='1'::xid8;`);
      const target = await ticket(db); const delivery = await deliveryFor(db, target.id);
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [delivery.delivery_id, delivery.lease_token, rule.id, rule.version], '55000');
    });
    await scenario('processing activation must also be visible in the captured snapshot', async () => {
      const rule = await createRule(db); await activate(db); const target = await ticket(db); const delivery = await deliveryFor(db, target.id);
      await owner(db); await db.exec("update private.automation_processing_state set activation_transaction=(pg_current_xact_id()::text::bigint+100)::text::xid8"); await service(db);
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [delivery.delivery_id, delivery.lease_token, rule.id, rule.version], '55000');
    });
    for (const operation of ['edit', 'disable', 'archive', 'deactivate', 'reactivate']) await scenario(`${operation} after admission prevents further actions without changing pinned history`, async () => {
      const context = await ready(db); const original = structuredClone(context.rule.definition);
      await identity(db);
      if (operation === 'edit') await db.query('select public.update_automation_rule($1,$2,$3,$4)', [org, context.rule.id, context.rule.version, { ...original, name: 'Edited name' }]);
      if (operation === 'disable') await db.query('select public.set_automation_rule_enabled($1,$2,$3,false)', [org, context.rule.id, context.rule.version]);
      if (operation === 'archive') await db.query('select public.archive_automation_rule($1,$2,$3)', [org, context.rule.id, context.rule.version]);
      if (operation === 'deactivate' || operation === 'reactivate') await activate(db, false);
      if (operation === 'reactivate') await activate(db);
      await service(db); const step = await execute(db, context); assert.equal(step.status, 'failed');
      assert.equal(step.error_code, ['deactivate', 'reactivate'].includes(operation) ? 'processing_inactive' : 'rule_unavailable');
      await owner(db); const pinned = (await db.query('select definition from public.automation_rule_versions where rule_id=$1 and version=$2', [context.rule.id, context.execution.rule_version])).rows[0]; assert.deepEqual(pinned.definition, original);
    });
    await scenario('nonmatching AND conditions skip actions and retain safe condition results', async () => {
      const context = await ready(db, [action()], group(condition('priority', 'equals', 'critical'), condition('status', 'equals', 'new', 'second')));
      assert.equal(context.execution.status, 'skipped'); assert.deepEqual(context.execution.conditions.map(item => item.status), ['failed', 'passed']);
      assert.equal((await execute(db, context)).status, 'not_attempted'); assert.equal(context.execution.actions_attempted, 0);
      assert.doesNotMatch(JSON.stringify(context.execution.conditions), /critical|"new"/);
    });
    await scenario('execution/event/rule uniqueness, chain recursion guard and bounded work', async () => {
      const rule = await createRule(db, [action('set_priority', { priority: 'critical' })], group(), org, 'ticket.priority_changed'); await activate(db);
      const target = await ticket(db); await db.query("update public.tickets set priority='high' where id=$1", [target.id]); const delivery = await deliveryFor(db, target.id, 'ticket.priority_changed');
      const execution = await begin(db, delivery, rule); assert.equal((await begin(db, delivery, rule)).id, execution.id);
      assert.equal((await execute(db, { rule, delivery, execution })).status, 'succeeded');
      const childDelivery = await deliveryFor(db, target.id, 'ticket.priority_changed');
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [childDelivery.delivery_id, childDelivery.lease_token, rule.id, rule.version], '54000');
      const work = await ready(db); await owner(db); await db.query('update private.automation_chains set action_count=100 where correlation_id=$1', [work.execution.correlation_id]); await service(db);
      assert.equal((await execute(db, work)).error_code, 'chain_limit');
    });
    await scenario('depth and execution-count budgets are enforced independently of duplicate claims', async () => {
      const priorityRule = await createRule(db, [action()], group(), org, 'ticket.priority_changed');
      const createRuleToo = await createRule(db); const context = await ready(db);
      await owner(db); await db.query('update private.automation_chains set execution_count=32 where correlation_id=$1', [context.execution.correlation_id]); await service(db);
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [context.delivery.delivery_id, context.delivery.lease_token, createRuleToo.id, createRuleToo.version], '54000');
      await owner(db); let parent = context.execution.event_id;
      for (let depth = 1; depth <= 8; depth++) parent = (await db.query("select private.publish_domain_event($1,'ticket.priority_changed','ticket',$2,$3,$4,$5,array['priority'],$6,$7) id", [org, context.target.id, depth + 1, { priority: 'normal' }, { priority: 'high' }, context.execution.correlation_id, parent])).rows[0].id;
      await service(db); const delivery = (await db.query('select * from public.claim_domain_events(100,900)')).rows.find(item => item.event.id === parent);
      assert.equal(delivery.event.depth, 8);
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [delivery.delivery_id, delivery.lease_token, priorityRule.id, priorityRule.version], '54000');
    });
    await scenario('persisted target mismatch is independently rejected and completed receipts survive lease rotation', async () => {
      const context = await ready(db);
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [context.delivery.delivery_id, context.delivery.lease_token, context.rule.id, context.rule.version + 1], '22023');
      await owner(db); await db.query('update public.automation_executions set entity_id=$2 where id=$1', [context.execution.id, id(9)]); await service(db);
      await denied(db, 'select public.execute_automation_ticket_step($1,$2,$3)', [context.execution.id, context.delivery.lease_token, command({ ...context.execution, entity_id: id(9) }, context.rule.definition.actions[0])]);
      await owner(db); await db.query('update public.automation_executions set entity_id=$2 where id=$1', [context.execution.id, context.target.id]); await service(db);
      const receipt = await execute(db, context);
      await owner(db); await db.query("update private.domain_event_deliveries set leased_at=statement_timestamp()-interval '2 minutes',lease_expires_at=statement_timestamp()-interval '1 minute',available_at=statement_timestamp()-interval '1 minute' where id=$1", [context.delivery.delivery_id]);
      const delivery = await deliveryFor(db, context.target.id); assert.deepEqual(await execute(db, { ...context, delivery }), receipt);
      assert.equal((await rows(db, 'public.tickets', 'id', context.target.id))[0].revision, 2);
    });
    await scenario('service subject is not impersonated in activity, audit, or assignment notification suppression', async () => {
      const context = await ready(db, [action('assign_technician', { technicianId: worker })]);
      await identity(db, worker, 'service_role'); assert.equal((await execute(db, context)).status, 'succeeded');
      assert.equal((await db.query('select auth.uid() id')).rows[0].id, worker, 'caller claims restored');
      const notifications = await rows(db, 'public.notifications', 'ticket_id', context.target.id);
      assert.ok(notifications.some(item => item.recipient_id === worker));
      const activity = await rows(db, 'public.ticket_activity', 'ticket_id', context.target.id);
      assert.ok(activity.some(item => item.actor_id === null && item.details.automationExecutionId === context.execution.id));
      await service(db);
      await denied(db, "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'internal_note','Forged human')", [org, context.target.id, worker]);
      await denied(db, "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body,author_type,automation_execution_id,automation_step_id,automation_name) values($1,$2,null,'internal_note','Forged','automation',$3,$4,'Forged')", [org, context.target.id, context.execution.id, id(9)]);
    });
    await scenario('expired lease cannot mutate; reclaim rotates authority and keeps the pinned execution', async () => {
      const context = await ready(db); await owner(db);
      await db.query("update private.domain_event_deliveries set leased_at=statement_timestamp()-interval '2 minutes',lease_expires_at=statement_timestamp()-interval '1 minute',available_at=statement_timestamp()-interval '1 minute' where id=$1", [context.delivery.delivery_id]);
      await service(db); await denied(db, 'select public.execute_automation_ticket_step($1,$2,$3)', [context.execution.id, context.delivery.lease_token, command(context.execution, context.rule.definition.actions[0])]);
      const reclaimed = await deliveryFor(db, context.target.id); assert.notEqual(reclaimed.lease_token, context.delivery.lease_token);
      assert.equal((await begin(db, reclaimed, context.rule)).id, context.execution.id);
      await denied(db, 'select public.execute_automation_ticket_step($1,$2,$3)', [context.execution.id, context.delivery.lease_token, command(context.execution, context.rule.definition.actions[0])]);
      assert.equal((await execute(db, { ...context, delivery: reclaimed })).status, 'succeeded');
    });
    await scenario('Stage 5 notification action now uses the same trusted command boundary', async () => {
      const context = await ready(db, [action('send_notification', { recipient: 'requester', template: 'ticket_update' })]);
      const step = await execute(db, context);
      assert.equal(step.status, 'succeeded'); assert.equal(step.result.entityType, 'notification');
    });
    await scenario('two-tenant administrator reads; technician/end-user/MFA denial and service direct bypass denial', async () => {
      const context = await ready(db);
      const otherRule = await createRule(db, [action()], group(), otherOrg); const otherTarget = await ticket(db, otherOrg); const otherDelivery = await deliveryFor(db, otherTarget.id); const otherExecution = await begin(db, otherDelivery, otherRule);
      await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [context.delivery.delivery_id, context.delivery.lease_token, otherRule.id, otherRule.version]);
      for (const [actor, expected] of [[admin, context.execution.id], [otherAdmin, otherExecution.id], [worker, null], [employee, null]]) {
        await identity(db, actor);
        assert.deepEqual((await db.query('select id from public.automation_executions')).rows.map(row => row.id), expected ? [expected] : []);
        assert.equal((await db.query('select count(*)::int n from public.automation_execution_steps')).rows[0].n, expected ? 1 : 0);
        await denied(db, "update public.automation_executions set status='succeeded' where id=$1", [context.execution.id]);
        await denied(db, 'select public.execute_automation_ticket_step($1,$2,$3)', [context.execution.id, context.delivery.lease_token, command(context.execution, context.rule.definition.actions[0])]);
        await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [context.delivery.delivery_id, context.delivery.lease_token, context.rule.id, context.rule.version]);
      }
      await owner(db); await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')", [admin]);
      await identity(db); assert.equal((await db.query('select count(*)::int n from public.automation_executions')).rows[0].n, 0);
      await identity(db, admin, 'authenticated', 'aal2'); assert.equal((await db.query('select count(*)::int n from public.automation_executions')).rows[0].n, 1);
      await service(db);
      for (const table of ['public.automation_executions', 'public.automation_execution_steps', 'private.automation_processing_state', 'private.automation_command_contexts', 'private.automation_chains', 'private.automation_chain_claims', 'private.automation_version_visibility']) await denied(db, `select * from ${table}`);
      await denied(db, 'select private.set_automation_processing(true)');
      await db.query("select set_config('app.domain_event_delivery',$1,true),set_config('app.domain_event_lease',$2,true)", [context.delivery.delivery_id, context.delivery.lease_token]);
      await denied(db, "update public.tickets set priority='critical' where id=$1", [context.target.id]);
      await denied(db, "insert into private.automation_command_contexts values(pg_current_xact_id(),$1,$2,$3)", [org, context.execution.id, id(9)]);
      await identity(db); await denied(db, "insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body,author_type) values($1,$2,null,'internal_note','Forged','automation')", [org, context.target.id]);
    });
    await scenario('SQL condition results match established pure evaluator across every registered operator', async () => {
      await owner(db); let cases = 0;
      const values = { priority: ['low', 'normal', 'high', 'critical'], status: ['new', 'resolved'], title: ['Network request', 'NETWORK REQUEST', 'Other title', 'ΟΣΟΣ', 'ΟΣ', 'İSTANBUL'], category_id: [null, category], requester_id: [employee], team_id: [null, team] };
      for (const [field, actuals] of Object.entries(values)) for (const operator of registry.field('ticket', field) ? (await db.query('select private.automation_definition_catalog() as catalog')).rows[0].catalog.fields[`ticket:${field}`].operators : []) {
        const expected = actuals.find(value => value !== null);
        const leaf = condition(field, operator, ['in', 'not_in'].includes(operator) ? [expected] : expected);
        for (const actual of [...actuals, undefined, null, true, '', 123]) {
          const snapshot = actual === undefined ? {} : { [field]: actual }; const def = definition({ conditions: group(leaf) });
          const result = (await db.query('select private.automation_condition_results($1,$2,$3) as results', [def, snapshot, 'ticket'])).rows[0].results;
          assert.deepEqual(result, evaluateConditions(def.conditions, snapshot, registry, 'ticket').results, `${field} ${operator} ${actual}`); cases++;
        }
      }
      t.diagnostic(`${cases} condition result parity cases`);
    });
    await scenario('Unicode lowercase matches JavaScript, including default full mapping and contextual sigma', async () => {
      await owner(db);
      const examples = ['İSTANBUL', 'ΟΣ', 'ΟΣΟΣ', 'ΟΣ\u0301', 'ΟΣ\u0301Α', 'Σ', 'Σ\u0301', 'AΣ\u0345Α', 'AΣ\u0345', 'CAFÉ', 'ẞ', 'ÉQUIPE', 'K', '𐐀', '', 'A İSTANBUL ΟΣΟΣ ΟΣ'];
      let changed = '';
      for (let point = 1; point <= 0x10ffff; point++) {
        if (point >= 0xd800 && point <= 0xdfff) continue;
        const character = String.fromCodePoint(point);
        if (character !== character.toLowerCase()) changed += character;
      }
      // Include stored mappings too: a runtime with an older Unicode version
      // must fail this gate rather than silently accept different comparisons.
      const sql = (await db.query("select pg_get_functiondef('private.automation_lower(text)'::regprocedure) source")).rows[0].source;
      changed += sql.match(/translate\(character,'([^']*)'/u)[1];
      const characters = [...changed];
      for (let start = 0; start < characters.length; start += 100) examples.push(characters.slice(start, start + 100).join(''));
      for (const input of examples) assert.equal((await db.query('select private.automation_lower($1) value', [input])).rows[0].value, input.toLowerCase(), input);
    });
    await t.test('execution table and RPC types exactly match migrated schema; records preserve Stage 1 models', async () => {
      const source = ts.createSourceFile('schema.ts', await readFile('src/types/automation-execution-database.ts', 'utf8'), ts.ScriptTarget.Latest, true);
      const alias = name => source.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === name).type;
      for (const [table, type] of [['automation_executions', 'AutomationExecutionRow'], ['automation_execution_steps', 'AutomationExecutionStepRow']]) {
        const columns = (await db.query('select column_name from information_schema.columns where table_schema=$1 and table_name=$2', ['public', table])).rows.map(row => row.column_name).sort();
        assert.deepEqual(columns, alias(type).members.map(member => member.name.getText(source)).sort());
      }
      for (const fn of alias('AutomationExecutionFunctions').members) {
        const actual = (await db.query('select proargnames from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname=$1 and proname=$2', ['public', fn.name.getText(source)])).rows[0].proargnames;
        assert.deepEqual(actual.sort(), fn.type.members.find(member => member.name.getText(source) === 'Args').type.members.map(member => member.name.getText(source)).sort());
      }
    });
    await scenario('persisted failure maps to a safe Stage 1 execution and step model', async () => {
      const { executionRecord, executionStepRecord, executionError } = load('src/features/automation/execution-records.ts');
      const context = await ready(db); await activate(db, false); await service(db);
      const failed = await execute(db, context); const [stored] = await rows(db, 'public.automation_executions', 'id', context.execution.id);
      const execution = executionRecord(stored), step = executionStepRecord(failed);
      assert.equal(execution.ruleVersion, context.rule.version); assert.equal(execution.organizationId, org); assert.equal(execution.actionsAttempted, 1); assert.equal(execution.status, 'failed');
      assert.deepEqual(execution.error, executionError('processing_inactive')); assert.equal(step.error.code, 'processing_inactive');
      assert.equal(step.actionId, 'action-0'); assert.equal(step.idempotencyKey, failed.idempotency_key); assert.equal(step.result, null);
      assert.equal(executionError(null), null); assert.match(executionError('action_failed').message, /No changes/);
    });
  } finally { await db.close(); }
});

test('committed activation/version transactions are visible to later event transactions', async () => {
  const db = await migratedPostgres();
  try {
    await db.exec('begin'); await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    const rule = await createRule(db); await activate(db); await db.exec('commit');
    await db.exec('begin'); const target = await ticket(db); const delivery = await deliveryFor(db, target.id); const execution = await begin(db, delivery, rule);
    assert.equal(execution.status, 'running'); assert.equal((await execute(db, { rule, delivery, execution })).status, 'succeeded');
    await db.exec('commit');
  } finally { await db.close(); }
});

test('Stage 4 upgrades existing rule versions, events and human notes without activating historical work', async () => {
  let legacy;
  const db = await migratedPostgres({ beforeMigration: async (db, name) => {
    if (name !== '20261001022623_automation_execution_authority.sql') return;
    await db.exec('begin'); await db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
    const rule = await createRule(db); const target = await ticket(db);
    const note = (await db.query("insert into public.ticket_messages(organization_id,ticket_id,author_id,kind,body) values($1,$2,$3,'internal_note','Existing human note') returning *", [org, target.id, admin])).rows[0];
    legacy = { rule, target, note }; await db.exec('commit');
  } });
  try {
    const [note] = await rows(db, 'public.ticket_messages', 'id', legacy.note.id);
    assert.equal(note.author_type, 'member'); assert.equal(note.author_id, admin); assert.equal(note.automation_execution_id, null); assert.equal(note.body, legacy.note.body);
    assert.equal((await rows(db, 'public.automation_rule_versions', 'rule_id', legacy.rule.id)).length, 2);
    assert.equal((await rows(db, 'private.automation_version_visibility', 'rule_id', legacy.rule.id)).length, 2);
    assert.equal((await db.query('select active from private.automation_processing_state')).rows[0].active, false);
    assert.equal((await rows(db, 'public.tickets', 'id', legacy.target.id))[0].revision, 1);
    await db.exec('begin'); await activate(db); const delivery = await deliveryFor(db, legacy.target.id);
    await denied(db, 'select public.begin_automation_execution($1,$2,$3,$4)', [delivery.delivery_id, delivery.lease_token, legacy.rule.id, legacy.rule.version], '55000');
    await db.exec('rollback');
  } finally { await db.close(); }
});
