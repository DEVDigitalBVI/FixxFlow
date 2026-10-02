/** Bounded real-time default-cadence smoke; local Supabase only. About six minutes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {service,sql,json,literal,ok} from './automation-stage12b-local.mjs';
import {definition,action,group} from '../fixtures/automation.mjs';
import {load} from './load-module.mjs';
const {orgA,orgB,users}=JSON.parse(readFileSync('/tmp/fixxflow-stage12b-test-session.json','utf8'));
const {runAutomationWorker}=load('src/features/automation/worker.ts',{'server-only':{}});
const {automationWorkerRepository}=load('src/features/automation/worker-repository.ts',{'server-only':{}});
const {observeAutomationRun}=load('src/features/automation/operations-telemetry.ts',{'server-only':{}});
const logs=[],invocations=[],actionLatencyMs=[];
const store=automationWorkerRepository(service),execute=store.execute;
store.execute=async(...args)=>{const start=performance.now();try{return await execute(...args);}finally{actionLatencyMs.push(performance.now()-start);}};
const draft=definition({conditions:group(),actions:[action('add_internal_note',{body:'Synthetic Stage12B note excluded from logs'})]});
const identity=user=>`set local role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify({sub:user.id,role:'authenticated',aal:'aal2'}))},true);`;
const stats=()=>JSON.parse(sql(`select jsonb_build_object('relations',coalesce(jsonb_object_agg(relname,jsonb_build_object('rows',n_live_tup,'bytes',pg_total_relation_size(relid),'indexBytes',pg_indexes_size(relid))),'{}')) from pg_stat_user_tables where schemaname in ('public','private') and (relname like 'automation_%' or relname like 'domain_event%' or relname='ticket_messages')`));
const before=stats();
function enqueue(tenant,user,count,label) {
 sql(`begin;${identity(user)}insert into public.tickets(organization_id,requester_id,title,description) select '${tenant}','${user.id}',${literal(label)}||n,'Synthetic only' from generate_series(1,${count})n;commit;`);
}
async function worker(phase) {
 const start=performance.now();
 const result=await observeAutomationRun(service,'worker',()=>runAutomationWorker(store,{enabled:true,log:row=>logs.push(row)}),r=>({claimed:r.claimed,acknowledged:r.acknowledged,failures:r.failed,retried:r.retried,deferred:r.deferred,capacityDeferred:r.capacityDeferred}));
 const counts=JSON.parse(sql(`select coalesce(jsonb_object_agg(organization_id,n),'{}') from(select organization_id,count(*) n from public.automation_executions where status='succeeded' group by organization_id)s`));
 const queue=JSON.parse(sql(`select jsonb_build_object('pending',count(*) filter(where status='pending'),'leased',count(*) filter(where status='leased'),'deferred',count(*) filter(where capacity_reason is not null),'oldestPendingSeconds',extract(epoch from clock_timestamp()-min(created_at) filter(where status='pending'))) from private.domain_event_deliveries where created_at >= ${literal(startedAt)}::timestamptz`));
 invocations.push({phase,at:new Date().toISOString(),elapsedMs:performance.now()-start,result,counts,queue});
 console.log(JSON.stringify({phase,result,queue}));
 assert.equal(result.failed,0);assert.equal(result.retried,0);
 return result;
}
const startedAt=new Date().toISOString();
try {
 assert.equal(sql('select active from private.automation_processing_state'),'f');
 for(const [org,user] of [[orgA,users[0]],[orgB,users[1]]]) sql(`begin;${identity(user)}do $$ declare r public.automation_rules;begin for r in select * from public.automation_rules where organization_id='${org}' and enabled loop perform public.set_automation_rule_enabled('${org}',r.id,r.version,false);end loop;r:=public.create_automation_rule('${org}',${json(draft)});perform public.set_automation_rule_enabled('${org}',r.id,1,true);end $$;commit;`);
 sql('select private.set_automation_processing(true)');
 const start=performance.now();
 for(let i=0;i<3;i++) {
  await delay(Math.max(0,start+i*60000-performance.now()));
  enqueue(orgA,users[0],3,'Steady A ');enqueue(orgB,users[1],1,'Steady B ');
  assert.equal((await worker('steady')).acknowledged,4);
 }
 await delay(Math.max(0,start+180000-performance.now()));
 assert.equal(sql(`select count(*) from public.automation_executions where status='succeeded'`),'12');
 enqueue(orgA,users[0],12,'Burst A ');enqueue(orgB,users[1],2,'Burst B ');
 const burstStart=performance.now();let completed=0;
 for(let i=0;i<4;i++) {
  await delay(Math.max(0,burstStart+i*60000-performance.now()));
  completed+=(await worker('burst')).acknowledged;
  if(i===1) assert.equal(invocations.at(-1).counts[orgB],5);
  if(completed===14) break;
 }
 assert.equal(completed,14);
 assert.equal(sql('select count(*) from public.ticket_messages where automation_execution_id is not null'),'26');
 assert.equal(sql(`select count(*) from public.automation_executions where status='succeeded'`),'26');
 assert.doesNotMatch(JSON.stringify(logs),/Synthetic|body|password|token|secret|description|definition/i);
 assert.ok(logs.some(r=>r.eventId&&r.deliveryId&&r.executionId&&r.stepId&&r.correlationId&&r.ruleId&&r.ruleVersion));
 // Environment OFF does not even call claim; database OFF also returns no lease.
 const offBefore=sql('select count(*) from public.automation_execution_steps');
 assert.equal((await runAutomationWorker(store,{enabled:false})).claimed,0);
 sql('select private.set_automation_processing(false)');
 assert.equal(ok(await service.rpc('claim_automation_events',{})).length,0);
 assert.equal(sql('select count(*) from public.automation_execution_steps'),offBefore);
 const sorted=actionLatencyMs.toSorted((a,b)=>a-b);
 const report={scope:'Local Supabase PG17, actual PostgREST worker, unmodified 60-second cadence; short smoke only',engine:sql('show server_version'),startedAt,finishedAt:new Date().toISOString(),steady:{arrivals:12,observationSeconds:180,completed:12,ratePerMinute:4},burst:{arrivals:14,completed,drainSeconds:(performance.now()-burstStart)/1000},actionLatencyMs:{count:sorted.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)},invocations,before,after:stats(),sanitizedTrace:'PASS',processing:'OFF'};
 writeFileSync('/tmp/fixxflow-stage12b-capacity-results.json',JSON.stringify(report,null,2));
 console.log('PASS default_cadence_fairness_burst_recovery_and_OFF');
} finally { sql('select private.set_automation_processing(false)'); }
