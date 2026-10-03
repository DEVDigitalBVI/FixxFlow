import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from '../../../tests/helpers/load-module.mjs';
const { serviceHealth, queueHealth, approachingWindow, operationsPolicy }=load('src/features/automation/operations-model.ts');
const now='2026-10-01T12:00:00Z';
const heartbeat={lastStartedAt:null,lastCompletedAt:null,lastSuccessfulAt:null,latestResult:null,latestStartedAt:null,latestCompletedResult:null};
const recent={...heartbeat,lastStartedAt:'2026-10-01T11:59:20Z',lastCompletedAt:'2026-10-01T11:59:40Z',lastSuccessfulAt:'2026-10-01T11:59:40Z',latestResult:'succeeded',latestCompletedResult:'succeeded'};
test('health distinguishes OFF, unknown, recent success, incomplete, stale and degraded invocations',()=>{
 assert.equal(serviceHealth(false,recent,now),'disabled');assert.equal(serviceHealth(true,heartbeat,now),'unknown');assert.equal(serviceHealth(true,recent,now),'healthy');
 assert.equal(serviceHealth(true,{...recent,lastStartedAt:'2026-10-01T11:57:59Z',latestResult:'running'},now),'delayed');
 assert.equal(serviceHealth(true,{...recent,lastStartedAt:'2026-10-01T11:56:59Z'},now),'delayed');
 for(const result of ['failed','degraded'])assert.equal(serviceHealth(true,{...recent,latestCompletedResult:result},now),'degraded');
 assert.equal(serviceHealth(true,{...heartbeat,lastStartedAt:now,latestResult:'running'},now),'unknown');
 assert.equal(serviceHealth(true,{...recent,lastSuccessfulAt:'2026-10-01T11:56:59Z'},now),'delayed');
 assert.equal(serviceHealth(true,{...recent,lastSuccessfulAt:'2026-10-01T11:57:00Z'},now),'healthy');
});
test('health thresholds agree with actual cron intervals and invocation budgets',()=>{
 const crons=JSON.parse(readFileSync('vercel.json','utf8')).crons;
 for(const path of ['/api/cron/automation','/api/cron/automation-scheduler']){
  assert.equal(crons.find(c=>c.path===path).schedule,'* * * * *');
  assert.match(readFileSync(`src/app${path}/route.ts`,'utf8'),new RegExp(`maxDuration = ${operationsPolicy.runtimeSeconds}`));
 }
 assert.equal(operationsPolicy.intervalSeconds,60);
});
test('SLA approach classifications include exact cadence and deadline boundaries',()=>{
 const threshold='2026-10-01T11:55:00Z',deadline=now;
 assert.equal(approachingWindow(threshold,deadline,'2026-10-01T11:55:00Z'),'within_window');
 assert.equal(approachingWindow(threshold,deadline,'2026-10-01T11:56:00Z'),'within_window');
 assert.equal(approachingWindow(threshold,deadline,'2026-10-01T11:56:00.001Z'),'late_before_deadline');
 assert.equal(approachingWindow(threshold,deadline,'2026-10-01T11:59:59Z'),'late_before_deadline');
 assert.equal(approachingWindow(threshold,deadline,now),'missed_window');
 assert.equal(approachingWindow(threshold,deadline,'2026-10-01T12:00:01Z'),'missed_window');
 assert.equal(approachingWindow(threshold,'2026-10-01T12:00:00.000002Z','2026-10-01T12:00:00.000001Z'),'late_before_deadline');
 assert.equal(approachingWindow(threshold,deadline,'2026-10-01T11:56:00.000001Z'),'late_before_deadline');
});
test('queue warnings distinguish partial unknown readings, old work, terminal failures and intentional OFF',()=>{
 const q={truncated:false,oldestEligibleAt:null,recent:{failed:0,exhausted:0}};
 assert.equal(queueHealth(true,q,now),'healthy');assert.equal(queueHealth(true,{...q,truncated:true},now),'unknown');
 assert.equal(queueHealth(true,{...q,oldestEligibleAt:'2026-10-01T11:56:59Z'},now),'delayed');
 assert.equal(queueHealth(true,{...q,recent:{failed:0,exhausted:1}},now),'degraded');assert.equal(queueHealth(false,q,now),'disabled');assert.equal(queueHealth(true,{...q,recent:{failed:0,exhausted:0,guardrailTerminated:1}},now),'degraded');
});
test('invocation telemetry preserves worker results/failures and never converts telemetry errors into execution failures',async()=>{
 const calls=[];const {observeAutomationRun}=load('src/features/automation/operations-telemetry.ts',{'server-only':{}});
 const client={rpc:async(name,args)=>{calls.push({name,args});return{data:name==='start_automation_run'?'00000000-0000-4000-8000-000000000001':true,error:null};}};
 const value=await observeAutomationRun(client,'worker',async()=>({done:true}),()=>({claimed:2,executions:1,failures:0}));assert.deepEqual(value,{done:true});assert.equal(calls[1].args.outcome,'succeeded');
 calls.length=0;await observeAutomationRun(client,'worker',async()=>1,()=>({deferred:3,capacityDeferred:3}));assert.equal(calls[1].args.outcome,'succeeded');
 calls.length=0;await observeAutomationRun(client,'worker',async()=>1,()=>({retried:1}));assert.equal(calls[1].args.outcome,'degraded');
 calls.length=0;await assert.rejects(observeAutomationRun(client,'discovery',async()=>{throw Error('PRIVATE');},()=>({})),/PRIVATE/);assert.equal(calls[1].args.outcome,'failed');assert.doesNotMatch(JSON.stringify(calls),/PRIVATE/);
 const log=console.error;const logs=[];console.error=value=>logs.push(value);
 try{assert.equal(await observeAutomationRun({rpc:async()=>{throw Error('SECRET');}},'worker',async()=>42,()=>({})),42);assert.doesNotMatch(logs.join(''),/SECRET/);}finally{console.error=log;}
});
test('history filters validate dates, cursor, ticket number and preserve filter values',()=>{
 const {operationsHistoryFilters}=load('src/features/automation/operations-service.ts',{'server-only':{},'./ui-service':{},'@/lib/supabase/server':{}});
 const f=operationsHistoryFilters({q:' Route ',from:'2026-09-01',to:'2026-09-30',result:'retry_exhausted',ticket:'1842'});assert.equal(f.error,'');assert.equal(f.query,'Route');assert.equal(f.until,'2026-10-01T00:00:00.000Z');
 for(const filters of [{from:'bad'},{from:'2026-02-30'},{from:'2026-01-01',to:'2026-12-31'},{before:now},{cursor:'bad'},{ticket:'-1'},{result:'secret'}])assert.ok(operationsHistoryFilters(filters).error);
 assert.equal(operationsHistoryFilters({result:'guardrail'}).error,'');
});

test('operational invocation identity is available to worker/discovery logging',async()=>{
 const {observeAutomationRun}=load('src/features/automation/operations-telemetry.ts',{'server-only':{}});
 let observed;
 const client={rpc:async name=>({data:name==='start_automation_run'?'test-invocation':true,error:null})};
 await observeAutomationRun(client,'worker',async id=>{observed=id;return 1;},()=>({claimed:1}));
 assert.equal(observed,'test-invocation');
});
