import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from './load-module.mjs';
import { definition, group, action } from '../fixtures/automation.mjs';

export const ids = { org: '20000000-0000-0000-0000-000000000401', otherOrg: '20000000-0000-0000-0000-000000000402', admin: '10000000-0000-0000-0000-000000000401', otherAdmin: '10000000-0000-0000-0000-000000000402', worker: '10000000-0000-0000-0000-000000000403', employee: '10000000-0000-0000-0000-000000000404' };
export const owner = db => db.exec('reset role');
export async function identity(db, role = 'authenticated', actor = ids.admin) {
  assert.ok(['authenticated', 'service_role', 'anon'].includes(role));
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor, role, aal: 'aal1' })]);
}
export const service = db => identity(db, 'service_role', null);
export const seed = async db => db.exec(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
export const tick = () => new Promise(resolve => setTimeout(resolve, 2));
export async function activate(db, enabled = true) { await owner(db); await db.query('select private.set_automation_processing($1)', [enabled]); await tick(); }
export async function createRule(db, { actions = [action()], conditions = group(), trigger = 'ticket.created', tenant = ids.org, enabled = true } = {}) {
  await identity(db, 'authenticated', tenant === ids.org ? ids.admin : ids.otherAdmin);
  let rule = (await db.query('select * from public.create_automation_rule($1,$2)', [tenant, definition({ actions, conditions, trigger: { type: trigger, configuration: {} } })])).rows[0];
  if (enabled) rule = (await db.query('select * from public.set_automation_rule_enabled($1,$2,$3,true)', [tenant, rule.id, rule.version])).rows[0];
  await tick(); return rule;
}
export async function ticket(db, tenant = ids.org) {
  await identity(db, 'authenticated', tenant === ids.org ? ids.admin : ids.otherAdmin);
  return (await db.query("insert into public.tickets(organization_id,requester_id,title,description) values($1,$2,'Worker test','SECRET DESCRIPTION') returning *", [tenant, tenant === ids.org ? ids.employee : ids.otherAdmin])).rows[0];
}
// Real migrated SQL through the same repository API. A savepoint models one RPC
// transaction inside the surrounding rolled-back test scenario. This adapter is
// not PostgREST and makes no claim of independent concurrent database sessions.
export function databaseClient(db) {
  const allowed = new Set(['claim_automation_events', 'discover_automation_rules', 'begin_automation_execution', 'execute_automation_ticket_step', 'get_automation_execution', 'finish_domain_event_delivery']);
  return { from() { throw Error('Worker must never use table writes'); }, rpc(name, args) {
    assert.ok(allowed.has(name));
    let pending;
    const run = () => pending ??= (async () => {
      await db.exec('savepoint worker_rpc');
      try {
        const entries = Object.entries(args ?? {}); const params = entries.map(([,value]) => value);
        const result = await db.query(`select * from public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')})`, params);
        await db.exec('release savepoint worker_rpc');
        return { data: name === 'finish_domain_event_delivery' ? result.rows[0][name] : result.rows, error: null, status: 200 };
      } catch (error) {
        await db.exec('rollback to savepoint worker_rpc; release savepoint worker_rpc');
        return { data: null, error: { code: error.code }, status: 400 };
      }
    })();
    return { then(resolve, reject) { return run().then(resolve, reject); }, single() { return run().then(result => ({ ...result, data: result.data?.[0] ?? null })); } };
  } };
}
const failures = load('src/features/automation/worker-failures.ts');
export const { AutomationWorkerError, classifyWorkerFailure } = failures;
const mocks = { 'server-only': {}, './worker-failures': failures };
export const { runAutomationWorker } = load('src/features/automation/worker.ts', mocks);
export const { automationWorkerRepository } = load('src/features/automation/worker-repository.ts', mocks);
export const storeFor = db => automationWorkerRepository(databaseClient(db));
export async function state(db) {
  await owner(db);
  const read = async table => (await db.query(`select * from ${table} order by id`)).rows;
  return { executions: await read('public.automation_executions'), steps: await read('public.automation_execution_steps'), deliveries: await read('private.domain_event_deliveries'), notifications: await read('public.notifications') };
}
