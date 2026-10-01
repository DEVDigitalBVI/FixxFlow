/** Optional native PostgreSQL check. Run only against a freshly initialized,
 * disposable localhost cluster. Creates its own database; never accepts a URL,
 * credentials, hosted target, or an existing application database.
 * FIXXFLOW_TEMPORAL_TEST_PORT=55499 node tests/helpers/automation-temporal-concurrency.mjs
 */
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { definition, action, group } from '../fixtures/automation.mjs';
const port=process.env.FIXXFLOW_TEMPORAL_TEST_PORT;
if(!port||!/^\d+$/.test(port)||Number(port)<1024)throw Error('Explicit disposable localhost port required');
const binary=process.env.FIXXFLOW_TEST_PSQL??'/opt/homebrew/opt/postgresql@18/bin/psql';
const database='fixxflow_temporal_concurrency';
function session(sql,db=database){
 const child=spawn(binary,['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-d',db],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='',ready;const locked=new Promise(resolve=>{ready=resolve;});
 child.stdout.on('data',data=>{stdout+=data;if(stdout.includes('LOCKED'))ready();});child.stderr.on('data',data=>{stderr+=data;});
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(Error(stderr)));});
 child.stdin.end(sql);return{done,locked};
}
const query=sql=>session(sql).done;
const org='20000000-0000-0000-0000-000000000401',admin='10000000-0000-0000-0000-000000000401',requester='10000000-0000-0000-0000-000000000404';
const jwt=`select set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal1"}',true);`;
const service='set local role service_role;';
const draft=definition({trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:1}},conditions:group(),actions:[action('add_internal_note',{body:'Independent concurrency verification.'})]});
const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
await session(`create database ${database};`,'postgres').done;
await query(await readFile('tests/fixtures/supabase-bootstrap.sql','utf8'));
for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await query(await readFile(`supabase/migrations/${file}`,'utf8'));
await query(await readFile('tests/fixtures/domain-events.sql','utf8'));
await query(`select private.set_automation_processing(true);begin;${jwt}set local role authenticated;select public.create_automation_rule('${org}',${json(draft)});commit;`);
const ruleId=(await query('select id from public.automation_rules')).trim();
await query(`begin;${jwt}set local role authenticated;select public.set_automation_rule_enabled('${org}','${ruleId}',1,true);commit;`);
const ticketId=(await query(`begin;${jwt}insert into public.tickets(organization_id,requester_id,title,description,created_at) values('${org}','${requester}','Concurrent test','Synthetic test data',clock_timestamp()-interval '60 seconds') returning id;commit;`)).trim().split('\n').at(-1);
const first=session(`begin;select id from public.automation_rules where id='${ruleId}' for update;select 'LOCKED';select pg_sleep(2);${service}select public.discover_temporal_automation();commit;`);
await first.locked;
const second=await query(`begin;${service}select public.discover_temporal_automation();commit;`);
assert.equal(JSON.parse(second.trim()).emitted,0);
const firstOutput=(await first.done).trim().split('\n').findLast(line=>line.startsWith('{'));
assert.equal(JSON.parse(firstOutput).emitted,1);
assert.equal((await query('select count(*) from private.automation_temporal_occurrences')).trim(),'1');
const lease=JSON.parse((await query(`begin;${service}select row_to_json(d) from public.claim_automation_events(5,120) d;commit;`)).trim());
const execution=JSON.parse((await query(`begin;${service}select row_to_json(x) from public.begin_automation_execution('${lease.delivery_id}','${lease.lease_token}','${ruleId}',2) x;commit;`)).trim());
const command={organizationId:org,entityId:ticketId,action:draft.actions[0]};
const stepSql=`select row_to_json(s) from public.execute_automation_ticket_step('${execution.id}','${lease.lease_token}',${json(command)}) s;`;
const worker1=session(`begin;select id from private.domain_event_deliveries where id='${lease.delivery_id}' for update;select 'LOCKED';select pg_sleep(2);${service}${stepSql}commit;`);
await worker1.locked;
const worker2=session(`begin;${service}${stepSql}commit;`);
await Promise.all([worker1.done,worker2.done]);
assert.equal((await query(`select count(*) from public.ticket_messages where automation_execution_id='${execution.id}'`)).trim(),'1');
assert.equal((await query(`select attempts from public.automation_execution_steps where execution_id='${execution.id}'`)).trim(),'1');
assert.equal((await query(`select status from public.automation_executions where id='${execution.id}'`)).trim(),'succeeded');
// A rollback after publication removes occurrence/event/delivery/cursor together.
await query(`begin;${jwt}insert into public.tickets(organization_id,requester_id,title,description,created_at) values('${org}','${requester}','Rollback test','Synthetic',clock_timestamp()-interval '60 seconds');commit;`);
await query(`begin;${service}select public.discover_temporal_automation();rollback;`);
assert.equal((await query('select count(*) from private.automation_temporal_occurrences')).trim(),'1');
const recovery=JSON.parse((await query(`begin;${service}select public.discover_temporal_automation();commit;`)).trim());assert.equal(recovery.emitted,1);
// Stage 10: independent completion attempts fence the same invocation row.
const runId=(await query(`begin;${service}select public.start_automation_run('discovery');commit;`)).trim();
const completing=session(`begin;select id from private.automation_runs where id='${runId}' for update;select 'LOCKED';select pg_sleep(1);${service}select public.finish_automation_run('${runId}','succeeded','{"rules":1,"emitted":1}');commit;`);
await completing.locked;
const conflicting=session(`begin;${service}select public.finish_automation_run('${runId}','failed','{"failures":1}');commit;`);
assert.equal((await conflicting.done).trim(),'f');await completing.done;
assert.equal((await query(`select outcome from private.automation_runs where id='${runId}'`)).trim(),'succeeded');
assert.equal((await query(`select count(*) from private.automation_runs where id='${runId}'`)).trim(),'1');
await query('select private.set_automation_processing(false);');
console.log(JSON.stringify({postgres:(await query('show server_version')).trim(),cleanReplay:'PASS',overlappingDiscovery:'PASS',independentDuplicateAction:'PASS',oneNoteOneAttempt:'PASS',rollbackRecovery:'PASS',concurrentHeartbeatCompletion:'PASS',processing:'OFF'}));
