// Read-only product audit: reproduce current defects in disposable PGlite only.
// These assertions describe observed bugs, NOT desired regression expectations.
import assert from 'node:assert/strict';
import { migratedPostgres } from './postgres.mjs';
import { seed, ids, owner, identity, service, activate, createRule, ticket, storeFor, runAutomationWorker } from './automation-worker.mjs';
import { definition, group, action } from '../fixtures/automation.mjs';

const evidence = {};
const oversized = definition({
  conditions: group(),
  trigger: { type: 'ticket.open_duration_reached', configuration: { durationMinutes: 1 } },
  actions: Array.from({ length: 5 }, (_, position) => action('add_internal_note', { body: '界'.repeat(18000) }, position)),
});
let legacy;
const db = await migratedPostgres({ beforeMigration: async (database, file) => {
  if (!file.endsWith('_automation_guardrails.sql')) return;
  await database.exec('begin');
  await seed(database);
  await identity(database);
  legacy = (await database.query('select * from public.create_automation_rule($1,$2)', [ids.org, oversized])).rows[0];
  legacy = (await database.query('select * from public.set_automation_rule_enabled($1,$2,$3,true)', [ids.org, legacy.id, legacy.version])).rows[0];
  await identity(database, 'authenticated', ids.otherAdmin);
  const healthy = (await database.query('select * from public.create_automation_rule($1,$2)', [ids.otherOrg, {
    ...oversized, actions: [action('add_internal_note', { body: 'Healthy tenant' })],
  }])).rows[0];
  await database.query('select * from public.set_automation_rule_enabled($1,$2,$3,true)', [ids.otherOrg, healthy.id, healthy.version]);
  await owner(database);
  await database.exec('commit');
} });

async function captureError(sql, params = []) {
  await db.exec('savepoint audit_probe');
  let code = null;
  try { await db.query(sql, params); } catch (error) { code = error.code; }
  finally { await db.exec('rollback to savepoint audit_probe; release savepoint audit_probe'); }
  return code;
}

try {
  await db.exec('begin');
  try {
    assert.equal((await db.query('select active from private.automation_processing_state')).rows[0].active, false);
    await identity(db);
    const disable = await captureError('select public.set_automation_rule_enabled($1,$2,$3,false)', [ids.org, legacy.id, legacy.version]);
    const archive = await captureError('select public.archive_automation_rule($1,$2,$3)', [ids.org, legacy.id, legacy.version]);
    assert.equal(disable, 'FF004'); assert.equal(archive, 'FF004');
    evidence.legacyControls = { bytes: Buffer.byteLength(JSON.stringify(oversized)), preUpgradeCreation: 'accepted', disable, archive };
    await activate(db);
    await owner(db);
    const before = (await db.query('select organization_id,last_discovered_at from private.automation_tenant_schedule order by organization_id')).rows;
    await service(db);
    const failures = [];
    for (let i = 0; i < 3; i++) failures.push(await captureError('select public.discover_temporal_automation()'));
    assert.deepEqual(failures, ['FF004', 'FF004', 'FF004']);
    await owner(db);
    const after = (await db.query('select organization_id,last_discovered_at from private.automation_tenant_schedule order by organization_id')).rows;
    assert.deepEqual(after, before);
    assert.equal((await db.query('select count(*)::int n from private.automation_temporal_cursors')).rows[0].n, 0);
    evidence.legacyDiscovery = { failures, tenantScheduleUnchanged: true, healthyTenantScans: 0 };
  } finally { await owner(db); await db.exec('rollback'); }

  await db.exec('begin');
  try {
    // Shrink the legacy definitions through authorized editing for the next,
    // independent scenario. No persisted fixture or migration is modified.
    await identity(db);
    await db.query('select public.update_automation_rule($1,$2,$3,$4)', [ids.org, legacy.id, legacy.version, { ...oversized, actions: [action('add_internal_note', { body: 'Small' })] }]);
    // An ordinary created event is permanently ineligible for temporal-only org A.
    await ticket(db);
    await createRule(db, { tenant: ids.otherOrg, actions: [action('add_internal_note', { body: 'Queue work' })] });
    await activate(db);
    for (let i = 0; i < 20; i++) await ticket(db, ids.otherOrg);
    await service(db);
    const calls = [];
    for (let i = 0; i < 4; i++) calls.push(await runAutomationWorker(storeFor(db), { enabled: true }));
    const claimed = calls.map(result => result.claimed);
    const totalClaimed = claimed.reduce((sum, value) => sum + value, 0);
    // PGlite clock resolution can produce schedule ties; assert lost service
    // slots, not an exact native-PostgreSQL rotation sequence.
    assert.ok(totalClaimed > 0 && totalClaimed < 20);
    assert.ok(calls.every(result => result.failed === 0 && result.capacityDeferred === 0));
    evidence.ineligibleTenantUtilization = { claimed, requestedSlots: 20, completed: calls.reduce((sum, result) => sum + result.acknowledged, 0) };
  } finally { await owner(db); await db.exec('rollback'); }
  await db.exec('begin');
  try {
    await owner(db);
    await db.exec("insert into auth.users(id,email) select ('90000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'audit'||n||'@example.invalid' from generate_series(1,121)n");
    await db.query("insert into public.organization_memberships(organization_id,user_id,role) select $1,id,'technician' from auth.users where id::text like '90000000-%'", [ids.org]);
    await createRule(db, { actions: [action('set_status', { status: 'open' })] });
    await activate(db);
    await identity(db);
    await db.query("insert into public.tickets(organization_id,requester_id,title,description,status) values($1,$2,'Audit fanout','Synthetic','resolved')", [ids.org, ids.employee]);
    await service(db);
    await runAutomationWorker(storeFor(db), { enabled: true });
    await identity(db);
    const summary = (await db.query('select public.read_automation_operations($1) result', [ids.org])).rows[0].result.executions;
    const history = (await db.query("select public.read_automation_operations_history($1,result_filter=>'action_failed',until_at=>clock_timestamp()+interval '1 second') result", [ids.org])).rows[0].result;
    assert.equal(summary.guardrailTerminated, 1);
    assert.equal(summary.actionFailed, 0);
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0].error_code, 'notification_fanout_limit');
    evidence.historyClassification = { summaryActionFailed: summary.actionFailed, summaryGuardrailTerminated: summary.guardrailTerminated, actionFailedFilterRows: history.rows.length, errorCode: history.rows[0].error_code };
  } finally { await owner(db); await db.exec('rollback'); }
  assert.equal((await db.query('select active from private.automation_processing_state')).rows[0].active, false);
  evidence.finalProcessingActive = false;
  console.log(JSON.stringify(evidence, null, 2));
} finally { await db.close(); }
