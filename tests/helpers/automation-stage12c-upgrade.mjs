/** Large synthetic migration/locking probe: fixed disposable Docker identity only. */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { definition, action, group } from '../fixtures/automation.mjs';
const workdir = '/tmp/fixxflow-stage12c-upgrade', container = 'supabase_db_fixxflow-stage12c-upgrade';
assert.match(readFileSync(`${workdir}/supabase/config.toml`, 'utf8'), /project_id = "fixxflow-stage12c-upgrade"/);
const args = name => ['exec', '-i', '-e', `PGAPPNAME=${name}`, container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
const q = input => execFileSync('docker', args('stage12c-observer'), { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }).trim();
function query(input, name) {
  const child = spawn('docker', args(name), { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '', ready;
  const locked = new Promise(resolve => { ready = resolve; });
  child.stdout.on('data', value => { output += value; if (output.includes('LOCKED')) ready(); });
  child.stderr.on('data', value => { error += value; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve({ code, output: output.trim(), error })); });
  child.stdin.end(input); return { locked, done };
}
assert.match(q('show server_version'), /^17\./);
assert.equal(q('select count(*) from supabase_migrations.schema_migrations'), '39');
assert.equal(q('select active from private.automation_processing_state'), 'f');
q(readFileSync('tests/fixtures/domain-events.sql', 'utf8'));
const org = '20000000-0000-0000-0000-000000000401', admin = '10000000-0000-0000-0000-000000000401';
const identity = `set local role authenticated;select set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal1"}',true);`;
const draft = JSON.stringify(definition({ conditions: group(), actions: [action('add_internal_note', { body: 'Synthetic migration history one' }), action('add_internal_note', { body: 'Synthetic migration history two' }, 1)] }));
q(`begin;${identity}do $$declare r public.automation_rules;begin for i in 1..101 loop r:=public.create_automation_rule('${org}','${draft}'::jsonb);perform public.set_automation_rule_enabled('${org}',r.id,1,true);end loop;end $$;commit;`);
const report = { scope: 'Local Supabase PG17; synthetic owner-seeded history for constraint scans, not executed action effects', engine: q('show server_version'), startedAt: new Date().toISOString(), samples: [], mutationMs: [] };
for (let batch = 0; batch < 20; batch++) {
  q(`begin;${identity}insert into public.tickets(organization_id,requester_id,title,description)select '${org}','${admin}','Stage12C migration ${batch}-'||n,'Synthetic only'from generate_series(1,5000)n;commit;`);
  console.log(`Seeded ${(batch + 1) * 5000} synthetic tickets/events/deliveries`);
}
q(`insert into public.automation_executions(organization_id,rule_id,rule_version,rule_name,event_id,delivery_id,trigger_type,entity_type,entity_id,correlation_id,root_event_id,depth,processing_generation,expected_entity_revision,status,conditions,started_at,completed_at,actions_attempted,error_code)
select e.organization_id,r.id,r.version,r.definition->>'name',e.id,d.id,e.event_type,e.entity_type,e.entity_id,e.correlation_id,e.root_event_id,0,0,e.entity_version,'failed','[]',e.occurred_at,e.occurred_at,1,'action_failed'
from private.domain_events e join private.domain_event_deliveries d on d.event_id=e.id cross join lateral(select *from public.automation_rules order by id limit 1)r;
insert into public.automation_execution_steps(organization_id,execution_id,action_id,action_type,position,attempts,status,started_at,completed_at,error_code)
select e.organization_id,e.id,'action-'||n,'add_internal_note',n,case when n=0 then 1 else 0 end,case when n=0 then 'failed' else 'not_attempted' end,case when n=0 then e.started_at end,case when n=0 then e.completed_at end,case when n=0 then 'action_failed' end from public.automation_executions e cross join generate_series(0,1)n;
analyze public.automation_executions;analyze public.automation_execution_steps;analyze private.domain_event_deliveries;`);
const snapshot = () => q(`select jsonb_build_object('rules',(select md5(string_agg(md5(to_jsonb(t)::text),''order by id))from public.automation_rules t),'versions',(select md5(string_agg(md5(to_jsonb(t)::text),''order by rule_id,version))from public.automation_rule_versions t),'executions',(select md5(string_agg(md5(to_jsonb(t)::text),''order by id))from public.automation_executions t),'steps',(select md5(string_agg(md5(to_jsonb(t)::text),''order by id))from public.automation_execution_steps t),'processing',(select to_jsonb(t)from private.automation_processing_state t))`);
report.before = JSON.parse(snapshot());
report.volume = JSON.parse(q(`select jsonb_build_object('tickets',(select count(*)from public.tickets),'events',(select count(*)from private.domain_events),'deliveries',(select count(*)from private.domain_event_deliveries),'executions',(select count(*)from public.automation_executions),'steps',(select count(*)from public.automation_execution_steps),'relations',(select jsonb_object_agg(relname,jsonb_build_object('tableBytes',pg_table_size(relid),'indexBytes',pg_indexes_size(relid)))from pg_stat_user_tables where relname in ('automation_executions','automation_execution_steps','domain_event_deliveries'))) `));
assert.equal(report.volume.executions, 100000); assert.equal(report.volume.steps, 200000);
const file = '20261002202406_automation_guardrails.sql', migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
const lock = query("begin;lock table public.automation_executions in access share mode;select 'LOCKED';select pg_sleep(4);commit;", 'stage12c-reader');
await lock.locked;
const blocked = query(`set lock_timeout='1s';${migration}`, 'stage12c-blocked-migration');
for (let i = 0; i < 8; i++) {
  await delay(100);
  report.samples.push(JSON.parse(q(`select coalesce(jsonb_agg(jsonb_build_object('application',application_name,'waitType',wait_event_type,'wait',wait_event,'blockedBy',pg_blocking_pids(pid),'queryAgeMs',extract(epoch from clock_timestamp()-query_start)*1000)),'[]')from pg_stat_activity where application_name like 'stage12c-%' and application_name<>'stage12c-observer'`)));
}
const blockedResult = await blocked.done; await lock.done;
assert.notEqual(blockedResult.code, 0); assert.match(blockedResult.error, /lock timeout/);
assert.equal(q("select to_regclass('private.automation_capacity')is null"), 't');
assert.equal(q('select count(*)from supabase_migrations.schema_migrations'), '39');
report.lockTimeoutRollback = 'PASS';
assert.ok(report.samples.flat().some(s => s.waitType === 'Lock' && s.blockedBy.length));
copyFileSync(`supabase/migrations/${file}`, `${workdir}/supabase/migrations/${file}`);
let finished = false, output = '';
const started = performance.now();
const cli = spawn('supabase', ['migration', 'up', '--local', '--workdir', workdir], { stdio: ['ignore', 'pipe', 'pipe'] });
cli.stdout.on('data', value => { output += value; }); cli.stderr.on('data', value => { output += value; });
const migrated = new Promise((resolve, reject) => { cli.on('error', reject); cli.on('close', code => { finished = true; resolve(code); }); });
const mutations = (async () => {
  do {
    const start = performance.now();
    const mutation = await query(`begin;set local statement_timeout='5s';${identity}insert into public.tickets(organization_id,requester_id,title,description)values('${org}','${admin}','Migration concurrent ticket','Synthetic only');commit;`, 'stage12c-ticket-writer').done;
    report.mutationMs.push(performance.now() - start);
    assert.equal(mutation.code, 0, 'Ordinary ticket mutation failed during migration');
    await delay(100);
  } while (!finished);
})();
assert.equal(await migrated, 0, 'Migration failed; do not repair history');
report.migrationMs = performance.now() - started;
await mutations; writeFileSync('/tmp/fixxflow-stage12c-upgrade-migration.private', output, { mode: 0o600 });
report.after = JSON.parse(snapshot()); assert.deepEqual(report.after, report.before);
assert.equal(q('select count(*)from supabase_migrations.schema_migrations'), '40');
assert.equal(q('select count(*)from public.automation_rules where enabled'), '101');
assert.throws(() => q(`begin;${identity}do $$declare r public.automation_rules;begin r:=public.create_automation_rule('${org}','${draft}'::jsonb);perform public.set_automation_rule_enabled('${org}',r.id,1,true);end $$;commit;`), /Active automation safety limit/);
report.legacyEnabled = 101; report.furtherEnableDenied = 'PASS'; report.preservation = 'PASS';
const sorted = report.mutationMs.toSorted((a, b) => a - b);
report.mutationLatency = { count: sorted.length, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], maxMs: sorted.at(-1) };
report.noMaintenanceWindowTarget = report.mutationLatency.p95Ms < 1000 && report.mutationLatency.maxMs < 2000 && report.migrationMs < 300000 ? 'PASS, local tested volume only' : 'FAIL';
report.processing = q('select active from private.automation_processing_state') === 'f' ? 'OFF' : 'UNEXPECTED';
report.finishedAt = new Date().toISOString();
writeFileSync('/tmp/fixxflow-stage12c-upgrade-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ volume: report.volume, migrationMs: report.migrationMs, mutations: report.mutationLatency, preservation: report.preservation, locking: report.lockTimeoutRollback, processing: report.processing }));
