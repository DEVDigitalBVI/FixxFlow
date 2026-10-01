import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { action, condition, group } from '../../../tests/fixtures/automation.mjs';
import { ids, seed, owner, service, identity, activate, createRule, ticket, storeFor, state, runAutomationWorker, AutomationWorkerError, classifyWorkerFailure } from '../../../tests/helpers/automation-worker.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const options = { enabled: true };
async function ready(db, ruleOptions) { const rule = await createRule(db, ruleOptions); await activate(db); const target = await ticket(db); await service(db); return { rule, target, store: storeFor(db) }; }
async function expire(db, deliveryId, attempts) {
  await owner(db);
  await db.query("update private.domain_event_deliveries set attempts=coalesce($2,attempts),leased_at=clock_timestamp()-interval '2 minutes',lease_expires_at=clock_timestamp()-interval '1 minute',available_at=clock_timestamp()-interval '1 minute' where id=$1", [deliveryId, attempts ?? null]);
  await service(db);
}
async function available(db, deliveryId) { await owner(db); await db.query("update private.domain_event_deliveries set available_at=clock_timestamp()-interval '1 second' where id=$1 and status='pending'", [deliveryId]); await service(db); }

test('Stage 5 worker integration through migrated database RPCs', async t => {
  const db = await migratedPostgres();
  const scenario = (name, run) => t.test(name, async () => {
    await db.exec('begin'); try { await seed(db); await run(); } finally { await db.exec('rollback'); }
  });
  try {
    await scenario('ticket created → event → matching AND rule → ordered assignment/priority → persisted completion', async () => {
      const { store, target } = await ready(db, { actions: [action('set_priority', { priority: 'critical' }, 1), action('assign_technician', { technicianId: ids.worker }, 0)], conditions: group(condition('priority', 'equals', 'normal'), condition('status', 'equals', 'new', 'status')) });
      const logs = []; const result = await runAutomationWorker(store, { ...options, log: row => logs.push(row) });
      assert.equal(result.acknowledged, 1); assert.equal(result.failed, 0);
      const saved = await state(db); assert.equal(saved.executions[0].status, 'succeeded'); assert.equal(saved.executions[0].actions_attempted, 2);
      assert.equal(saved.steps.length, 2); assert.ok(saved.steps.every(step => step.status === 'succeeded' && step.attempts === 1));
      const row = (await db.query('select * from public.tickets where id=$1', [target.id])).rows[0]; assert.equal(row.assigned_technician_id, ids.worker); assert.equal(row.priority, 'critical'); assert.equal(row.revision, 3);
      const children = (await db.query('select * from private.domain_events where automation_execution_id=$1 order by entity_version', [saved.executions[0].id])).rows;
      assert.deepEqual(children.map(row => row.event_type), ['ticket.assigned', 'ticket.priority_changed']);
      for (const child of children) { assert.equal(child.correlation_id, saved.executions[0].correlation_id); assert.equal(child.causation_id, saved.executions[0].event_id); assert.equal(child.depth, 1); }
      assert.ok(logs.some(row => row.executionId && row.ruleVersion && row.organizationId && row.eventType && row.correlationId));
      assert.doesNotMatch(JSON.stringify(logs), /SECRET|definition|leaseToken|description|body/);
    });
    await scenario('nonmatching rule persists skipped conditions and performs zero actions', async () => {
      const { store } = await ready(db, { conditions: group(condition('priority', 'equals', 'critical')) });
      assert.equal((await runAutomationWorker(store, options)).acknowledged, 1);
      const saved = await state(db); assert.equal(saved.executions[0].status, 'skipped'); assert.equal(saved.executions[0].conditions[0].status, 'failed');
      assert.equal(saved.executions[0].actions_attempted, 0); assert.equal(saved.steps[0].status, 'not_attempted'); assert.equal(saved.steps[0].attempts, 0);
    });
    for (const reason of ['disabled', 'before_activation', 'before_enablement', 'processing_off']) await scenario(`${reason} does not execute or claim historical work`, async () => {
      let rule;
      if (reason === 'before_enablement') { await activate(db); await ticket(db); rule = await createRule(db); }
      else { rule = await createRule(db, { enabled: reason !== 'disabled' }); if (reason !== 'before_activation' && reason !== 'processing_off') await activate(db); await ticket(db); if (reason === 'before_activation') await activate(db); }
      assert.ok(rule.id); await service(db); assert.equal((await runAutomationWorker(storeFor(db), options)).claimed, 0);
      assert.equal((await state(db)).executions.length, 0);
    });
    await scenario('multiple rules are ordered by created_at then ID; later mutations retain strict revision protection', async () => {
      const first = await createRule(db, { actions: [action('add_internal_note', { body: 'First note' })] });
      const second = await createRule(db); const third = await createRule(db);
      await activate(db); await ticket(db); await service(db); const store = storeFor(db); const seen = [];
      const wrapped = { ...store, begin: async (d, r) => { seen.push(r.id); return store.begin(d, r); } };
      await runAutomationWorker(wrapped, options); assert.deepEqual(seen, [first.id, second.id, third.id]);
      const saved = await state(db); const thirdRun = saved.executions.find(row => row.rule_id === third.id); assert.equal(thirdRun.error_code, 'stale_entity');
    });
    await scenario('discovery keyset pages preserve tied creation timestamps without omissions', async () => {
      const rules = [];
      for (let i=0;i<53;i++) rules.push(await createRule(db));
      await owner(db); await db.query('update public.automation_rules set created_at=$1 where organization_id=$2', [rules[0].created_at, ids.org]);
      await activate(db); await ticket(db); await service(db); const store = storeFor(db); const [delivery] = await store.claim();
      const first = await store.discover(delivery, null), second = await store.discover(delivery, first.at(-1).cursor);
      assert.equal(first.length, 50); assert.equal(second.length, 3);
      assert.deepEqual([...first,...second].map(row => row.rule.id), rules.map(row => row.id).sort());
    });
    await scenario('action failure stops remaining actions but preserves completed steps', async () => {
      const { store } = await ready(db, { actions: [action(), action('assign_technician', { technicianId: ids.worker }, 1), action('set_status', { status: 'resolved' }, 2)] });
      await owner(db); await db.query("update public.organization_memberships set status='inactive',deactivated_at=clock_timestamp() where user_id=$1", [ids.worker]); await service(db);
      await runAutomationWorker(store, options); const saved = await state(db);
      assert.equal(saved.executions[0].status, 'partially_completed'); assert.equal(saved.executions[0].error_code, 'unavailable_reference');
      assert.deepEqual(saved.steps.sort((a,b) => a.position-b.position).map(row => row.status), ['succeeded','failed','not_attempted']);
      assert.equal(saved.deliveries.find(row => row.id === saved.executions[0].delivery_id).status, 'acknowledged');
    });
    await scenario('retryable transport failure resumes after a committed step without repeating it', async () => {
      const { store } = await ready(db, { actions: [action('add_internal_note', { body: 'Exactly one note' }), action('set_priority', { priority: 'critical' }, 1)] });
      let lost = false;
      const flaky = { ...store, execute: async (...args) => { const result = await store.execute(...args); if (!lost) { lost = true; throw new AutomationWorkerError('transport'); } return result; } };
      assert.equal((await runAutomationWorker(flaky, options)).retried, 1);
      let saved = await state(db); const delivery = saved.deliveries.find(row => row.event_id === saved.executions[0].event_id); assert.equal(delivery.status, 'pending'); assert.equal(saved.executions[0].status, 'running');
      assert.ok(Date.parse(delivery.available_at) > Date.parse(delivery.updated_at));
      await available(db, delivery.id); assert.equal((await runAutomationWorker(store, options)).acknowledged, 1);
      saved = await state(db); assert.equal(saved.executions[0].status, 'succeeded'); assert.ok(saved.steps.every(row => row.attempts === 1));
      assert.equal((await db.query('select count(*)::int n from public.ticket_messages')).rows[0].n, 1);
    });
    await scenario('SQL serialization failure rolls back the attempt and is retried', async () => {
      const { store } = await ready(db);
      await owner(db); await db.exec("create function private.test_transient_ticket() returns trigger language plpgsql as $$ begin raise exception 'Synthetic infrastructure failure' using errcode='40001'; end $$; create trigger test_transient_ticket before update on public.tickets for each row execute function private.test_transient_ticket();"); await service(db);
      assert.equal((await runAutomationWorker(store, options)).retried, 1); const saved = await state(db);
      assert.equal(saved.steps[0].attempts, 0); assert.equal(saved.steps[0].status, 'pending'); assert.equal(saved.executions[0].actions_attempted, 0);
    });
    await scenario('terminal authorization failure does not retry and closes unfinished execution', async () => {
      const { store } = await ready(db);
      const broken = { ...store, execute: async () => { throw new AutomationWorkerError('42501'); } };
      assert.equal((await runAutomationWorker(broken, options)).failed, 1); const saved = await state(db);
      assert.equal(saved.deliveries[0].status, 'dead'); assert.equal(saved.deliveries[0].error_code, 'authorization_failed'); assert.equal(saved.executions[0].error_code, 'delivery_failed'); assert.equal(saved.steps[0].status, 'not_attempted');
    });
    for (const crash of [false, true]) await scenario(`retry exhaustion terminalizes partial history (${crash ? 'expired final lease' : 'final retry acknowledgement'})`, async () => {
      const { store } = await ready(db, { actions: [action('add_internal_note', { body: 'Committed before exhaustion' }), action('set_priority', { priority: 'critical' }, 1)] });
      const [delivery] = await store.claim(); const [candidate] = await store.discover(delivery, null); const execution = await store.begin(delivery, candidate.rule); await store.execute(delivery, execution, candidate.rule.definition.actions[0]);
      if (crash) { await expire(db, delivery.deliveryId, 8); assert.equal((await store.claim()).length, 0); }
      else { await owner(db); await db.query('update private.domain_event_deliveries set attempts=8 where id=$1', [delivery.deliveryId]); await service(db); assert.equal(await store.finish(delivery, 'retry', 'transient_failure'), true); assert.equal(await store.finish(delivery, 'retry', 'transient_failure'), true); }
      const saved = await state(db); assert.equal(saved.deliveries[0].status, 'dead'); assert.equal(saved.deliveries[0].error_code, 'retry_exhausted');
      assert.equal(saved.executions[0].status, 'partially_completed'); assert.equal(saved.executions[0].error_code, 'retry_exhausted'); assert.ok(saved.executions[0].completed_at);
      assert.deepEqual(saved.steps.sort((a,b) => a.position-b.position).map(row => row.status), ['succeeded','not_attempted']);
    });
    await scenario('crash after claim/commit and overlapping invocation are token-fenced; reclaim resumes correctly', async () => {
      const { store } = await ready(db, { actions: [action('add_internal_note', { body: 'Crash-safe note' }), action('set_priority', { priority: 'critical' }, 1)] });
      const [delivery] = await store.claim(); const [candidate] = await store.discover(delivery, null); const execution = await store.begin(delivery, candidate.rule); const receipt = await store.execute(delivery, execution, candidate.rule.definition.actions[0]);
      assert.equal((await runAutomationWorker(storeFor(db), options)).claimed, 0, 'overlapping invocation cannot claim live lease');
      await expire(db, delivery.deliveryId); const [reclaimed] = await store.claim(); assert.notEqual(reclaimed.leaseToken, delivery.leaseToken);
      await assert.rejects(store.execute(delivery, execution, candidate.rule.definition.actions[1]), { code: '42501' });
      assert.equal((await store.execute(reclaimed, execution, candidate.rule.definition.actions[0])).id, receipt.id);
      assert.equal(await store.finish(delivery, 'acknowledged'), false);
      assert.equal((await runAutomationWorker({ ...store, claim: async () => [reclaimed] }, options)).acknowledged, 1);
      const saved = await state(db); assert.equal(saved.executions[0].status, 'succeeded'); assert.equal((await db.query('select count(*)::int n from public.ticket_messages')).rows[0].n, 1);
    });
    await scenario('notification enqueue is atomic, deduplicated and independent of external email credentials', async () => {
      const { store } = await ready(db, { actions: [action('assign_technician', { technicianId: ids.worker }), action('send_notification', { recipient: 'assigned_technician', template: 'ticket_update' }, 1), action('send_notification', { recipient: 'requester', template: 'ticket_update' }, 2)] });
      let lost = false;
      const flaky = { ...store, execute: async (...args) => { const receipt = await store.execute(...args); if (args[2].position === 1 && !lost) { lost = true; throw new AutomationWorkerError('transport'); } return receipt; } };
      assert.equal((await runAutomationWorker(flaky, options)).retried, 1); let saved = await state(db);
      assert.equal(saved.notifications.filter(row => row.kind === 'ticket_assigned').length, 1);
      assert.equal(saved.notifications.filter(row => row.kind === 'automation_update').length, 1);
      await available(db, saved.executions[0].delivery_id); await runAutomationWorker(store, options); saved = await state(db);
      assert.equal(saved.notifications.filter(row => row.kind === 'automation_update').length, 2); assert.equal(saved.executions[0].status, 'succeeded');
      assert.equal((await db.query('select count(*)::int n from private.notification_email_outbox')).rows[0].n, 3);
      assert.ok(saved.notifications.every(row => row.organization_id === ids.org && !/SECRET/.test(row.title)));
    });
    await scenario('missing/inactive recipient and forged cross-tenant notification payload fail without enqueue', async () => {
      const { store } = await ready(db, { actions: [action('send_notification', { recipient: 'assigned_technician', template: 'ticket_update' })] });
      const [delivery] = await store.claim(); const [candidate] = await store.discover(delivery, null); const execution = await store.begin(delivery, candidate.rule);
      await assert.rejects(store.execute(delivery, { ...execution, organization_id: ids.otherOrg }, candidate.rule.definition.actions[0]), { code: '22023' });
      await assert.rejects(store.execute(delivery, execution, { ...candidate.rule.definition.actions[0], configuration: { recipient: ids.otherAdmin, template: 'ticket_update' } }), { code: '22023' });
      assert.equal((await runAutomationWorker({ ...store, claim: async () => [delivery] }, options)).acknowledged, 1); const saved = await state(db);
      assert.equal(saved.steps[0].error_code, 'unavailable_reference'); assert.equal(saved.notifications.length, 0);
    });
    await scenario('notification recipient loses membership before enqueue and receives no explicit notification', async () => {
      const { store } = await ready(db, { actions: [action('assign_technician', { technicianId: ids.worker }), action('send_notification', { recipient: 'assigned_technician', template: 'ticket_update' }, 1)] });
      const wrapped = { ...store, execute: async (...args) => {
        if (args[2].type === 'send_notification') { await owner(db); await db.query("update public.organization_memberships set status='inactive',deactivated_at=clock_timestamp() where user_id=$1", [ids.worker]); await service(db); }
        return store.execute(...args);
      } };
      await runAutomationWorker(wrapped, options); const saved = await state(db);
      assert.equal(saved.executions[0].error_code, 'unavailable_reference'); assert.equal(saved.notifications.filter(row => row.kind === 'automation_update').length, 0);
      assert.equal(saved.notifications.filter(row => row.kind === 'ticket_assigned').length, 1);
    });
    await scenario('notification receipt failure rolls back both inbox and email enqueue', async () => {
      const { store } = await ready(db, { actions: [action('send_notification', { recipient: 'requester', template: 'ticket_update' })] });
      await owner(db); await db.exec("create function private.test_receipt_failure() returns trigger language plpgsql as $$ begin if new.status='succeeded' then raise exception 'SECRET'; end if; return new; end $$; create trigger test_receipt_failure before update on public.automation_execution_steps for each row execute function private.test_receipt_failure();"); await service(db);
      await runAutomationWorker(store, options); const saved = await state(db); assert.equal(saved.notifications.length, 0); assert.equal(saved.steps[0].error_code, 'action_failed');
      assert.equal((await db.query('select count(*)::int n from private.notification_email_outbox')).rows[0].n, 0);
    });
    await scenario('malformed worker definition and planner/database disagreement never execute actions', async () => {
      const { store } = await ready(db); const bad = { ...store, discover: async (...args) => (await store.discover(...args)).map(row => ({ ...row, rule: { ...row.rule, definition: { ...row.rule.definition, script: 'SECRET eval()' } } })) };
      assert.equal((await runAutomationWorker(bad, options)).failed, 1); let saved = await state(db); assert.equal(saved.executions.length, 0); assert.equal(saved.deliveries[0].error_code, 'invalid_configuration');
      const second = await ready(db); const disagree = { ...second.store, begin: async (...args) => ({ ...await second.store.begin(...args), conditions: [{ status: 'failed' }] }) };
      assert.equal((await runAutomationWorker(disagree, options)).failed, 1); saved = await state(db); assert.ok(saved.executions.every(row => row.actions_attempted === 0));
    });
    await scenario('processing off during a claimed delivery prevents further mutation', async () => {
      const { store } = await ready(db); const paused = { ...store, execute: async (...args) => { await activate(db, false); await service(db); return store.execute(...args); } };
      await runAutomationWorker(paused, options); const saved = await state(db); assert.equal(saved.executions[0].error_code, 'processing_inactive'); assert.equal(saved.steps[0].result, null);
    });
    await scenario('recursion prevention marks the child delivery terminal with an identifiable chain limit', async () => {
      await createRule(db, { trigger: 'ticket.priority_changed', actions: [action('set_priority', { priority: 'critical' })] }); await activate(db); const target = await ticket(db);
      await db.query("update public.tickets set priority='high' where id=$1", [target.id]); await service(db); const store = storeFor(db);
      await runAutomationWorker(store, options); const next = await runAutomationWorker(store, options); assert.equal(next.failed, 1);
      const saved = await state(db); assert.equal(saved.executions.length, 1); assert.ok(saved.deliveries.some(row => row.error_code === 'chain_limit'));
    });
    await scenario('depth-8 event is terminal before any worker action', async () => {
      const { store, target } = await ready(db, { trigger: 'ticket.priority_changed' });
      await owner(db); let parent = (await db.query('select id from private.domain_events where entity_id=$1', [target.id])).rows[0].id;
      for (let depth=1;depth<=8;depth++) parent = (await db.query("select private.publish_domain_event($1,'ticket.priority_changed','ticket',$2,$3,$4,$5,array['priority'],gen_random_uuid(),$6) id", [ids.org,target.id,depth+1,{priority:'normal'},{priority:'high'},parent])).rows[0].id;
      await service(db);
      const claimed = (await db.query('select * from public.claim_domain_events(100,120)')).rows.find(row => row.event.id === parent);
      const delivery = { deliveryId: claimed.delivery_id, leaseToken: claimed.lease_token, leaseExpiresAt: claimed.lease_expires_at, attempts: claimed.attempts, event: claimed.event };
      assert.equal((await runAutomationWorker({ ...store, claim: async () => [delivery] }, options)).failed, 1);
      const saved = await state(db); assert.equal(saved.executions.length, 0); assert.equal(saved.deliveries.find(row => row.id === delivery.deliveryId).error_code, 'chain_limit');
    });
    await scenario('two tenant event deliveries never discover or execute the other tenant rules', async () => {
      const first = await createRule(db); const second = await createRule(db, { tenant: ids.otherOrg }); await activate(db);
      await ticket(db); await ticket(db, ids.otherOrg); await service(db); const store = storeFor(db);
      assert.equal((await runAutomationWorker(store, options)).acknowledged, 2); const saved = await state(db);
      assert.equal(saved.executions.length, 2);
      for (const execution of saved.executions) assert.equal(execution.rule_id, execution.organization_id === ids.org ? first.id : second.id);
    });
    await scenario('unfinished executions cannot be acknowledged and invalid tokens cannot finalize another lease', async () => {
      const { store } = await ready(db); const [d] = await store.claim(); const [r] = await store.discover(d, null); await store.begin(d, r.rule);
      await assert.rejects(store.finish(d, 'acknowledged'), { code: '55000' });
      assert.equal(await store.finish({ ...d, leaseToken: ids.otherAdmin }, 'failed', 'permanent_failure'), false);
      assert.equal((await state(db)).executions[0].status, 'running');
    });
    await scenario('execution and action budgets are enforced across worker invocations', async () => {
      const { store } = await ready(db); const [d] = await store.claim(); const [r] = await store.discover(d, null); await store.begin(d, r.rule);
      await owner(db); await db.query('update private.automation_chains set action_count=100 where correlation_id=$1', [d.event.correlationId]); await service(db);
      await runAutomationWorker({ ...store, claim: async () => [d] }, options); assert.equal((await state(db)).executions[0].error_code, 'chain_limit');
      const another = await ready(db); const [next] = await another.store.claim();
      await owner(db); await db.query('insert into private.automation_chains(organization_id,correlation_id,execution_count) values($1,$2,32)', [ids.org, next.event.correlationId]); await service(db);
      assert.equal((await runAutomationWorker({ ...another.store, claim: async () => [next] }, options)).failed, 1);
    });
    await scenario('new worker RPCs deny ordinary clients and forged lease tokens', async () => {
      const { store } = await ready(db); const [d] = await store.claim();
      await assert.rejects(store.discover({ ...d, leaseToken: ids.otherAdmin }, null), { code: '42501' });
      for (const actor of [ids.admin, ids.worker, ids.employee]) {
        await identity(db, 'authenticated', actor); await assert.rejects(store.claim(), { code: '42501' }); await assert.rejects(store.discover(d, null), { code: '42501' });
      }
    });
  } finally { await db.close(); }
});

test('upgrade from Stage 4 repairs exhausted executions without replaying completed actions or changing processing control', async () => {
  let executionId, deliveryId;
  const db = await migratedPostgres({ beforeMigration: async (db, name) => {
    if (name !== '20261001025401_automation_worker_delivery.sql') return;
    await db.exec('begin'); await seed(db);
    const rule = await createRule(db, { actions: [action('add_internal_note', { body: 'Legacy committed note' }), action('set_priority', { priority: 'critical' }, 1)] });
    await activate(db); await ticket(db); await service(db);
    const d = (await db.query('select * from public.claim_domain_events()')).rows[0]; deliveryId = d.delivery_id;
    const execution = (await db.query('select * from public.begin_automation_execution($1,$2,$3,$4)', [d.delivery_id,d.lease_token,rule.id,rule.version])).rows[0]; executionId = execution.id;
    await db.query('select * from public.execute_automation_ticket_step($1,$2,$3)', [execution.id,d.lease_token,{organizationId:ids.org,entityId:execution.entity_id,action:rule.definition.actions[0]}]);
    await owner(db); await db.query('update private.domain_event_deliveries set attempts=8 where id=$1', [d.delivery_id]); await service(db);
    await db.query("select public.finish_domain_event_delivery($1,$2,'retry','transient_failure')", [d.delivery_id,d.lease_token]);
    await owner(db); assert.equal((await db.query('select status from public.automation_executions where id=$1', [execution.id])).rows[0].status, 'running');
    await activate(db, false); await db.exec('commit');
  } });
  try {
    const saved = await state(db); const execution = saved.executions.find(row => row.id === executionId);
    assert.equal(execution.status, 'partially_completed'); assert.equal(execution.error_code, 'retry_exhausted'); assert.ok(execution.completed_at);
    assert.equal(saved.deliveries.find(row => row.id === deliveryId).status, 'dead');
    assert.deepEqual(saved.steps.sort((a,b) => a.position-b.position).map(row => row.status), ['succeeded','not_attempted']);
    assert.equal((await db.query('select count(*)::int n from public.ticket_messages')).rows[0].n, 1);
    assert.equal((await db.query('select active from private.automation_processing_state')).rows[0].active, false);
    const source = ts.createSourceFile('worker.ts', await readFile('src/types/automation-worker-database.ts','utf8'),ts.ScriptTarget.Latest,true);
    const declaration = source.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'AutomationWorkerFunctions');
    for (const fn of declaration.type.members) {
      const expected = fn.type.members.find(node => node.name.getText(source) === 'Args').type.members.map(node => node.name.getText(source)).sort();
      const actual = (await db.query("select proargnames[1:pronargs] names from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=$1", [fn.name.getText(source)])).rows[0].names;
      assert.deepEqual(actual.sort(), expected);
    }
  } finally { await db.close(); }
});

test('central retry classification is bounded to known infrastructure failures', () => {
  for (const code of ['transport','lease_lost','budget_exhausted','40001','40P01','55P03','57014','PGRST003']) assert.equal(classifyWorkerFailure(new AutomationWorkerError(code)).outcome, 'retry');
  for (const code of ['22023','42501','55000','invalid_configuration','invalid_storage','planner_mismatch','54000']) assert.equal(classifyWorkerFailure(new AutomationWorkerError(code)).outcome, 'failed');
  assert.equal(classifyWorkerFailure(new Error('SECRET')).code, 'permanent_failure');
});
test('deployment kill switch does not construct work or touch storage', async () => {
  assert.equal((await runAutomationWorker({ claim() { throw Error('No work permitted'); } }, { enabled: false })).disabled, true);
});
test('cron checks the secret before privileged access; default OFF and missing email configuration are independent', async () => {
  const previous = { secret: process.env.CRON_SECRET, flag: process.env.AUTOMATION_PROCESSING_ENABLED };
  let calls = 0;
  const { GET } = load('src/app/api/cron/automation/route.ts', {
    '@/lib/supabase/admin': { createAdminClient() { calls++; return {}; } },
    '@/features/automation/worker-repository': { automationWorkerRepository: value => value },
    '@/features/automation/worker': { runAutomationWorker: async () => ({ acknowledged: 1 }) },
  });
  try {
    process.env.CRON_SECRET = 'test-cron-secret'; delete process.env.AUTOMATION_PROCESSING_ENABLED;
    assert.equal((await GET(new Request('https://example.invalid/api/cron/automation'))).status, 401); assert.equal(calls, 0);
    const authorized = () => new Request('https://example.invalid/api/cron/automation', { headers: { authorization: 'Bearer test-cron-secret' } });
    assert.deepEqual(await (await GET(authorized())).json(), { disabled: true }); assert.equal(calls, 0);
    process.env.AUTOMATION_PROCESSING_ENABLED = 'true'; assert.deepEqual(await (await GET(authorized())).json(), { acknowledged: 1 }); assert.equal(calls, 1);
    delete process.env.CRON_SECRET; assert.equal((await GET(authorized())).status, 401);
  } finally {
    for (const [key, value] of [['CRON_SECRET', previous.secret], ['AUTOMATION_PROCESSING_ENABLED', previous.flag]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
