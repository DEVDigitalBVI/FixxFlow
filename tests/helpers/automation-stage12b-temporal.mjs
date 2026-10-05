/** Bounded real PostgREST discovery and worker probe, local Supabase only. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {service,sql,json,literal,ok} from './automation-stage12b-local.mjs';
import {definition,action,group} from '../fixtures/automation.mjs';
import {load} from './load-module.mjs';
const {users}=JSON.parse(readFileSync('/tmp/fixxflow-stage12b-test-session.json','utf8'));
const {discoverTemporalAutomation}=load('src/features/automation/scheduler.ts',{'server-only':{}});
const {runAutomationWorker}=load('src/features/automation/worker.ts',{'server-only':{}});
const {automationWorkerRepository}=load('src/features/automation/worker-repository.ts',{'server-only':{}});
const admin=users[1].id,orgs=[randomUUID(),randomUUID()],rules=[];
const identity=`set local role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify({sub:admin,role:'authenticated',aal:'aal1'}))},true);`;
const draft=definition({trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:1}},conditions:group(),actions:[action('add_internal_note',{body:'Synthetic temporal discovery'})]});
for(const org of orgs){sql(`insert into public.organizations(id,name,slug)values('${org}','Stage12B temporal','temporal-${org}');insert into public.organization_memberships(organization_id,user_id,role)values('${org}','${admin}','administrator');`);const id=sql(`begin;${identity}select id from public.create_automation_rule('${org}',${json(draft)});commit;`).split('\n').at(-1);rules.push(id);sql(`begin;${identity}select public.set_automation_rule_enabled('${org}','${id}',1,true);commit;`);}
const counts=()=>sql(`select count(*) from private.automation_temporal_occurrences where organization_id in ('${orgs.join("','")}')`);
try{
 assert.equal(sql('select active from private.automation_processing_state'),'f');
 assert.equal(ok(await service.rpc('discover_temporal_automation',{})).emitted,0);
 sql('select private.set_automation_processing(true)');
 for(const [i,org] of orgs.entries())sql(`begin;${identity}reset role;insert into public.tickets(organization_id,requester_id,title,description,created_at)select '${org}','${admin}','Temporal synthetic '||n,'Synthetic',clock_timestamp()-interval '60 seconds' from generate_series(1,${i===0?210:1})n;commit;`);
 sql('begin;set local role service_role;select public.discover_temporal_automation();rollback;');assert.equal(counts(),'0');
 const discoveries=[];
 for(let i=0;i<4;i++){const value=await discoverTemporalAutomation(service);assert.ok(value.rules<=5);assert.ok(value.examined<=500);assert.ok(value.emitted<=500);discoveries.push(value);}
 assert.equal(counts(),'211');
 assert.equal(sql(`select count(*) from private.automation_temporal_occurrences where organization_id='${orgs[1]}'`),'1');
 assert.ok(discoveries[0].emitted>=101);assert.equal(discoveries.at(-1).emitted,0);
 const batches=[];
 for(let i=0;i<3;i++)batches.push(await runAutomationWorker(automationWorkerRepository(service),{enabled:true}));
 assert.ok(batches.some(r=>r.acknowledged>0));
 assert.equal(sql(`select count(*) from public.automation_executions where organization_id='${orgs[1]}' and status='succeeded'`),'1');
 const lag=JSON.parse(sql(`select jsonb_build_object('emitted',count(*),'maxLagSeconds',max(extract(epoch from e.occurred_at-o.threshold_at)),'minLagSeconds',min(extract(epoch from e.occurred_at-o.threshold_at))) from private.automation_temporal_occurrences o join private.domain_events e on e.id=o.event_id where o.organization_id in ('${orgs.join("','")}')`));
 const report={engine:sql('show server_version'),discovery:discoveries,worker:batches,lag,cursorRollbackRecovery:'PASS',idempotency:'PASS',smallTenantProgress:'PASS',scope:'Aged synthetic thresholds; not a real-time SLA-window or throughput measurement',processing:'OFF'};
 writeFileSync('/tmp/fixxflow-stage12b-temporal-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{sql('select private.set_automation_processing(false)');}
assert.equal(ok(await service.rpc('discover_temporal_automation',{})).emitted,0);
