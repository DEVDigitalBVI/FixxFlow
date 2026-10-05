/** Real-time local HTTP cadence probe. Roughly 80 minutes; no clock/window aging. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { sql, json, literal } from './automation-stage12c-local.mjs';
import { definition, action, group, condition } from '../fixtures/automation.mjs';

const base = 'http://localhost:3100';
const secret = readFileSync('/tmp/fixxflow-stage12c-cron.private', 'utf8');
const { users } = JSON.parse(readFileSync('/tmp/fixxflow-stage12c-test-session.json', 'utf8'));
const admin = users[1].id, orgs = Array.from({ length: 8 }, () => randomUUID());
const identity = `set local role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify({ sub: admin, role: 'authenticated', aal: 'aal1' }))},true);`;
const ids = orgs.map(literal).join(',');
const report = { scope: 'Local Docker Supabase PG17 and production-mode Next HTTP endpoints; not hosted capacity',
  engine: sql('show server_version'), startedAt: new Date().toISOString(), configuration: { cadenceSeconds: 60, batch: 5, steadyMinutes: 60, burst: 80 },
  tenants: orgs, samples: [], arrivalBatches: [], processing: 'OFF', result: 'RUNNING' };
const save = () => writeFileSync('/tmp/fixxflow-stage12c-capacity-results.json', JSON.stringify(report, null, 2));
const relations = () => JSON.parse(sql(`select coalesce(jsonb_object_agg(relname,jsonb_build_object('tableBytes',pg_table_size(relid),'indexBytes',pg_indexes_size(relid),'rowsEstimate',n_live_tup)),'{}') from pg_stat_user_tables where schemaname in ('public','private') and (relname like 'automation_%' or relname like 'domain_event%' or relname in ('notifications','ticket_messages'))`));
const queue = () => JSON.parse(sql(`select jsonb_build_object('total',count(*),'pending',count(*)filter(where status='pending'),'leased',count(*)filter(where status='leased'),'acknowledged',count(*)filter(where status='acknowledged'),'dead',count(*)filter(where status='dead'),'capacityDeferred',count(*)filter(where capacity_reason is not null),'retryPending',count(*)filter(where status='pending' and attempts>0),'oldestActionableSeconds',coalesce(extract(epoch from clock_timestamp()-min(created_at)filter(where status='pending' and available_at<=clock_timestamp())),0),'perTenant',(select jsonb_object_agg(organization_id,n)from(select organization_id,count(*)filter(where status='acknowledged')n from private.domain_event_deliveries where organization_id in (${ids}) group by organization_id)t)) from private.domain_event_deliveries where organization_id in (${ids})`));
async function endpoint(path) {
  const started = performance.now();
  const response = await fetch(base + path, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(65000) });
  assert.equal(response.status, 200, path);
  return { elapsedMs: performance.now() - started, result: await response.json() };
}
function enqueue(tenant, count, label) {
  const started = performance.now();
  sql(`begin;${identity}insert into public.tickets(organization_id,requester_id,title,description)select '${orgs[tenant]}','${admin}',${literal(label)}||n,'Synthetic only' from generate_series(1,${count})n;commit;`);
  report.arrivalBatches.push({ at: new Date().toISOString(), tenant, count, elapsedMs: performance.now() - started });
}
async function tick(phase, minute) {
  const discovery = await endpoint('/api/cron/automation-scheduler');
  const worker = await endpoint('/api/cron/automation');
  const current = queue();
  report.samples.push({ at: new Date().toISOString(), phase, minute, discovery, worker, queue: current });
  save(); console.log(JSON.stringify({ phase, minute, worker: worker.result, discovery: discovery.result, queue: current }));
  assert.equal(worker.result.failed, 0); assert.equal(worker.result.retried, 0);
  assert.ok(current.pending < 1500); assert.ok(current.oldestActionableSeconds < 1800);
  return current;
}

assert.equal(sql('select active from private.automation_processing_state'), 'f');
for (const path of ['/api/cron/automation', '/api/cron/automation-scheduler', '/api/cron/notifications']) {
  assert.equal((await fetch(base + path)).status, 401);
}
assert.equal((await fetch(base + '/api/cron/notifications', { headers: { authorization: `Bearer ${secret}` } })).status, 503);
report.unauthorizedEndpoints = 'PASS'; report.externalEmail = 'Unconfigured: dispatcher refuses before enqueue/send';
for (const [i, org] of orgs.entries()) {
  sql(`insert into public.organizations(id,name,slug)values('${org}','Stage12C load ${i}','stage12c-load-${org}');insert into public.organization_memberships(organization_id,user_id,role)values('${org}','${admin}','administrator');`);
  const actions = i % 2 ? [action('send_notification', { recipient: 'requester', template: 'ticket_update' })] : [action('add_internal_note', { body: 'Synthetic Stage12C capacity note' })];
  const drafts = [definition({ name: 'Steady workload', conditions: group(), actions }),
    definition({ name: 'Nonmatching workload', conditions: group(condition('title', 'equals', 'never-matches-synthetic-load')), actions })];
  if (i === 7) drafts.push(definition({ name: 'One-minute temporal workload', trigger: { type: 'ticket.open_duration_reached', configuration: { durationMinutes: 1 } }, conditions: group(), actions }));
  for (const draft of drafts) sql(`begin;${identity}do $$declare r public.automation_rules;begin r:=public.create_automation_rule('${org}',${json(draft)});perform public.set_automation_rule_enabled('${org}',r.id,1,true);end $$;commit;`);
}
report.before = relations(); save();
let small = 0;
try {
  sql('select private.set_automation_processing(true)');
  report.processing = 'ON, isolated controlled test';
  const started = performance.now();
  for (let minute = 0; minute < 60; minute++) {
    await delay(Math.max(0, started + minute * 60000 - performance.now()));
    const largeCount = minute % 5 < 2 ? 3 : 2;
    enqueue(0, largeCount, 'Steady large ');
    for (let n = largeCount; n < 4; n++) enqueue(1 + small++ % 7, 1, 'Steady small ');
    await tick('steady', minute);
  }
  await delay(Math.max(0, started + 60 * 60000 - performance.now()));
  const steady = await tick('steady-drain', 60);
  report.steady = { elapsedSeconds: (performance.now() - started) / 1000, inputTickets: 240, queue: steady };
  assert.equal(steady.pending, 0); assert.equal(steady.leased, 0);
  assert.ok(report.samples.filter(s => s.phase === 'steady').every(s => s.queue.oldestActionableSeconds < 180));
  enqueue(0, 66, 'Burst large '); for (let i = 1; i < 8; i++) enqueue(i, 2, 'Burst small ');
  const burstAt = performance.now();
  // First burst claim at the next minute, retaining the established cadence.
  for (let minute = 1; minute <= 30; minute++) {
    await delay(Math.max(0, burstAt + minute * 60000 - performance.now()));
    const state = await tick('burst-drain', minute);
    if (minute === 4) for (const org of orgs.slice(1)) assert.ok(state.perTenant[org] > steady.perTenant[org], 'Small tenant must progress within four burst invocations');
    if (state.pending === 0 && state.leased === 0) { report.burst = { drainSeconds: (performance.now() - burstAt) / 1000, queue: state }; break; }
  }
  assert.ok(report.burst, 'Burst did not drain within 30 minutes');
  report.executions = JSON.parse(sql(`select jsonb_object_agg(status,n)from(select status,count(*)n from public.automation_executions where organization_id in (${ids})group by status)t`));
  report.actionLatency = JSON.parse(sql(`select jsonb_build_object('count',count(*),'p50',percentile_cont(.5)within group(order by duration_ms),'p95',percentile_cont(.95)within group(order by duration_ms),'p99',percentile_cont(.99)within group(order by duration_ms),'max',max(duration_ms))from public.automation_execution_steps where organization_id in (${ids})and status='succeeded'`));
  assert.equal(sql(`select count(*)from public.automation_execution_steps where organization_id in (${ids})and attempts>1`), '0');
  assert.equal(sql(`select count(*)from private.domain_events e left join private.domain_event_deliveries d on d.event_id=e.id and d.organization_id=e.organization_id where e.organization_id in (${ids})and d.id is null`), '0');
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL'; report.failure = error instanceof assert.AssertionError ? error.message : 'Local probe failed; inspect private test log';
  process.exitCode = 1;
} finally {
  sql('select private.set_automation_processing(false)');
  report.processing = sql('select active from private.automation_processing_state') === 'f' ? 'OFF' : 'UNEXPECTED';
  report.finishedAt = new Date().toISOString(); report.after = relations(); save();
  console.log(JSON.stringify({ result: report.result, processing: report.processing }));
}
