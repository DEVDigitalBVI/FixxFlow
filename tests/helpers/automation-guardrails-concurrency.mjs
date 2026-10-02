/** Disposable localhost PostgreSQL only. Never accepts hosted URLs or existing app databases. */
import {spawn} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {definition,action,group} from '../fixtures/automation.mjs';
const port=process.env.FIXXFLOW_GUARDRAILS_TEST_PORT;
if(!port||!/^\d+$/.test(port)||Number(port)<1024)throw Error('Explicit disposable localhost port required');
const binary='/opt/homebrew/opt/postgresql@18/bin/psql',database=`fixxflow_guardrails_${process.pid}`;
function session(sql,db=database){
 const child=spawn(binary,['-X','-qAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-d',db],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='',ready;const locked=new Promise(r=>ready=r);
 child.stdout.on('data',data=>{stdout+=data;if(stdout.includes('LOCKED'))ready();});child.stderr.on('data',data=>stderr+=data);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve(stdout):reject(Error(stderr)));});child.stdin.end(sql);return{done,locked};
}
const query=sql=>session(sql).done;
const org='20000000-0000-0000-0000-000000000401',admin='10000000-0000-0000-0000-000000000401',requester='10000000-0000-0000-0000-000000000404';
const identity=`set local role authenticated;select set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal1"}',true);`;
const json=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
await session(`create database ${database} template template0 encoding 'UTF8';`,'postgres').done;
const bootstrap=(await readFile('tests/fixtures/supabase-bootstrap.sql','utf8')).replace(/create role ([^;]+);/g,(_,role)=>`do $$ begin create role ${role}; exception when duplicate_object then null; end $$;`);
await query(bootstrap);
for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await query(await readFile(`supabase/migrations/${file}`,'utf8'));
await query(await readFile('tests/fixtures/domain-events.sql','utf8'));
assert.equal((await query('select active from private.automation_processing_state')).trim(),'f');
const draft=definition({conditions:group(),actions:[action('send_notification',{recipient:'requester',template:'ticket_update'})]});
await query(`begin;${identity}do $$ declare r public.automation_rules;begin for i in 1..99 loop r:=public.create_automation_rule('${org}',${json(draft)});perform public.set_automation_rule_enabled('${org}',r.id,1,true);end loop;end $$;commit;`);
const create=async()=> (await query(`begin;${identity}select id from public.create_automation_rule('${org}',${json(draft)});commit;`)).trim().split('\n').at(-1);
const a=await create(),b=await create();
const enabling=session(`begin;${identity}select public.set_automation_rule_enabled('${org}','${a}',1,true);select 'LOCKED';select pg_sleep(1);commit;`);await enabling.locked;
await assert.rejects(query(`begin;${identity}select public.set_automation_rule_enabled('${org}','${b}',1,true);commit;`),/Active automation safety limit/);await enabling.done;
assert.equal((await query(`select count(*) from public.automation_rules where enabled`)).trim(),'100');
// Retain one rule for admission contention; only isolated tests activate.
await query(`begin;${identity}do $$ declare r public.automation_rules;begin for r in select * from public.automation_rules where enabled and id<>'${a}' loop perform public.set_automation_rule_enabled('${org}',r.id,r.version,false);end loop;end $$;commit;select private.set_automation_processing(true);`);
await query(`begin;${identity}insert into public.tickets(organization_id,requester_id,title,description) values('${org}','${requester}','Capacity first','Synthetic'),('${org}','${requester}','Capacity second','Synthetic');commit;`);
const leases=(await query('begin;set local role service_role;select row_to_json(d) from public.claim_automation_events(5,120) d;commit;')).trim().split('\n').filter(l=>l.startsWith('{')).map(JSON.parse);assert.equal(leases.length,2);
await query(`insert into private.automation_capacity(organization_id,resource,window_started_at,used) values('${org}','executions',clock_timestamp(),119);`);
const begin=d=>`select row_to_json(x) from public.begin_automation_execution('${d.delivery_id}','${d.lease_token}','${a}',2) x;`;
const admitting=session(`begin;set local role service_role;${begin(leases[0])}select 'LOCKED';select pg_sleep(1);commit;`);await admitting.locked;
await assert.rejects(query(`begin;set local role service_role;${begin(leases[1])}commit;`),/Execution delayed by capacity/);await admitting.done;
assert.equal((await query("select used from private.automation_capacity where resource='executions'")).trim(),'120');
await query("update private.automation_capacity set window_started_at=clock_timestamp()-interval '61 seconds' where resource='executions'");
await query(`begin;set local role service_role;${begin(leases[1])}commit;`);
const executions=(await query('select row_to_json(x) from public.automation_executions x order by entity_id')).trim().split('\n').map(JSON.parse);
await query(`insert into private.automation_capacity(organization_id,resource,subject,window_started_at,used) values('${org}','recipientNotifications','${requester}',clock_timestamp(),19);`);
const execute=x=>{const d=leases.find(d=>d.delivery_id===x.delivery_id);return `select row_to_json(s) from public.execute_automation_ticket_step('${x.id}','${d.lease_token}',${json({organizationId:org,entityId:x.entity_id,action:draft.actions[0]})}) s;`;};
const notifying=session(`begin;set local role service_role;${execute(executions[0])}select 'LOCKED';select pg_sleep(1);commit;`);await notifying.locked;
await assert.rejects(query(`begin;set local role service_role;${execute(executions[1])}commit;`),/Notification delayed by capacity/);await notifying.done;
assert.equal((await query('select count(*) from public.notifications')).trim(),'1');
assert.equal((await query("select used from private.automation_capacity where resource='recipientNotifications'")).trim(),'20');
assert.equal((await query(`select attempts from public.automation_execution_steps where execution_id='${executions[1].id}'`)).trim(),'0');
// A slow first tenant must not mark an unvisited second tenant as serviced.
const otherOrg='20000000-0000-0000-0000-000000000402',otherAdmin='10000000-0000-0000-0000-000000000402';
const temporal=definition({trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:1}},conditions:group(),actions:[action('add_internal_note',{body:'Deadline fairness'})]});
for(const [tenant,actor] of [[org,admin],[otherOrg,otherAdmin]]){
 await query(`begin;set local role authenticated;select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated","aal":"aal1"}',true);do $$ declare r public.automation_rules;begin r:=public.create_automation_rule('${tenant}',${json(temporal)});perform public.set_automation_rule_enabled('${tenant}',r.id,1,true);end $$;reset role;insert into public.tickets(organization_id,requester_id,title,description,created_at) values('${tenant}','${actor}','Deadline fairness','Synthetic',clock_timestamp()-interval '60 seconds');commit;`);
}
await query(`create function private.test_slow_discovery() returns trigger language plpgsql as $$ begin if new.organization_id='${org}' then perform pg_sleep(20.05);end if;return new;end $$;create trigger test_slow_discovery after insert on private.automation_temporal_occurrences for each row execute function private.test_slow_discovery();`);
await query('begin;set local role service_role;select public.discover_temporal_automation();commit;');
assert.equal((await query(`select last_discovered_at='-infinity' from private.automation_tenant_schedule where organization_id='${otherOrg}'`)).trim(),'t');
await query('drop trigger test_slow_discovery on private.automation_temporal_occurrences;');
await query('begin;set local role service_role;select public.discover_temporal_automation();commit;');
assert.equal((await query(`select count(*) from private.automation_temporal_occurrences where organization_id='${otherOrg}'`)).trim(),'1');
await query('select private.set_automation_processing(false);');
console.log(JSON.stringify({postgres:(await query('show server_version')).trim(),cleanReplay:'PASS',concurrentEnable:'PASS',concurrentExecutionAdmission:'PASS',concurrentRecipientNotification:'PASS',discoveryDeadlineFairness:'PASS',processing:'OFF'}));
