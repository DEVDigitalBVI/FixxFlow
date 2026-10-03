/** Early-failure handoff: stop synthetic arrivals, retain generation and cadence. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {sql,literal} from './automation-stage12c-local.mjs';
const pid=Number(process.argv[2]);assert.ok(Number.isInteger(pid)&&pid>1);
assert.equal(execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim(),'node tests/helpers/automation-stage12c-capacity.mjs');
const file='/tmp/fixxflow-stage12c-capacity-results.json';
const preliminary=JSON.parse(readFileSync(file,'utf8'));
assert.equal(preliminary.result,'RUNNING');assert.ok(preliminary.samples.some(s=>s.queue.oldestActionableSeconds>=180));
assert.equal(sql('select active from private.automation_processing_state'),'t');
process.kill(pid,'SIGTERM');
// This specific generator has no signal handler; its parent shell exits without
// a processing transition. The finally below now owns the OFF restoration.
const report=JSON.parse(readFileSync(file,'utf8'));
const ids=report.tenants.map(value=>{assert.match(value,/^[0-9a-f-]{36}$/);return literal(value);}).join(',');
const secret=readFileSync('/tmp/fixxflow-stage12c-cron.private','utf8');
const generation=sql('select generation from private.automation_processing_state');
const save=()=>writeFileSync(file,JSON.stringify(report,null,2));
const queue=()=>JSON.parse(sql(`select jsonb_build_object('total',count(*),'pending',count(*)filter(where status='pending'),'leased',count(*)filter(where status='leased'),'acknowledged',count(*)filter(where status='acknowledged'),'dead',count(*)filter(where status='dead'),'capacityDeferred',count(*)filter(where capacity_reason is not null),'retryPending',count(*)filter(where status='pending'and attempts>0),'oldestActionableSeconds',coalesce(extract(epoch from clock_timestamp()-min(created_at)filter(where status='pending'and available_at<=clock_timestamp())),0),'perTenant',(select jsonb_object_agg(organization_id,n)from(select organization_id,count(*)filter(where status='acknowledged')n from private.domain_event_deliveries where organization_id in (${ids})group by organization_id)t))from private.domain_event_deliveries where organization_id in (${ids})`));
async function endpoint(path){const start=performance.now();const response=await fetch('http://localhost:3100'+path,{headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(65000)});assert.equal(response.status,200);return {elapsedMs:performance.now()-start,result:await response.json()};}
report.result='FAIL';report.failure='Steady workload exceeded 180-second actionable age and accumulated backlog; stopped arrivals early to measure same-generation drain.';
report.handoff={at:new Date().toISOString(),generation,inputTickets:report.arrivalBatches.reduce((n,b)=>n+b.count,0),arrivalIntervals:report.samples.length,plannedSteadyMinutes:60,actualSampleSpanSeconds:(Date.parse(report.samples.at(-1).at)-Date.parse(report.samples[0].at))/1000,queue:queue(),processing:'ON, preserved for drain'};
report.unexecuted=['Remaining portion of planned 60-minute arrival phase','80-ticket additional burst'];
save();console.log(JSON.stringify({handoff:report.handoff}));
const lastAt=Date.parse(report.samples.at(-1).at),drainStarted=performance.now();
try {
  for(let minute=1;minute<=30;minute++){
    await delay(Math.max(0,lastAt+minute*60000-Date.now()));
    assert.equal(sql('select generation from private.automation_processing_state'),generation);
    const discovery=await endpoint('/api/cron/automation-scheduler'),worker=await endpoint('/api/cron/automation'),current=queue();
    report.samples.push({at:new Date().toISOString(),phase:'early-failure-drain',minute,discovery,worker,queue:current});save();
    console.log(JSON.stringify({minute,worker:worker.result,queue:current}));
    assert.equal(worker.result.failed,0);assert.equal(worker.result.retried,0);assert.equal(current.dead,0);
    if(current.pending===0&&current.leased===0){report.drain={result:'PASS',elapsedSeconds:(performance.now()-drainStarted)/1000,queue:current,generationUnchanged:true};break;}
  }
  assert.ok(report.drain,'Backlog did not drain in 30 unchanged-cadence invocations');
  report.executions=JSON.parse(sql(`select jsonb_object_agg(status,n)from(select status,count(*)n from public.automation_executions where organization_id in (${ids})group by status)t`));
  report.actionLatency=JSON.parse(sql(`select jsonb_build_object('count',count(*),'p50',percentile_cont(.5)within group(order by duration_ms),'p95',percentile_cont(.95)within group(order by duration_ms),'p99',percentile_cont(.99)within group(order by duration_ms),'max',max(duration_ms))from public.automation_execution_steps where organization_id in (${ids})and status='succeeded'`));
  assert.equal(sql(`select count(*)from public.automation_execution_steps where organization_id in (${ids})and attempts>1`),'0');
  assert.equal(sql(`select count(*)from private.domain_events e left join private.domain_event_deliveries d on d.event_id=e.id and d.organization_id=e.organization_id where e.organization_id in (${ids})and d.id is null`),'0');
  report.durableEventsAndUniqueSteps='PASS';
}catch(error){report.drain={result:'FAIL',error:error.message};process.exitCode=1;}
finally{
  sql('select private.set_automation_processing(false)');report.processing=sql('select active from private.automation_processing_state')==='f'?'OFF':'UNEXPECTED';
  report.finishedAt=new Date().toISOString();report.after=JSON.parse(sql(`select coalesce(jsonb_object_agg(relname,jsonb_build_object('tableBytes',pg_table_size(relid),'indexBytes',pg_indexes_size(relid),'rowsEstimate',n_live_tup)),'{}')from pg_stat_user_tables where schemaname in ('public','private')and(relname like 'automation_%'or relname like 'domain_event%'or relname in ('notifications','ticket_messages'))`));save();
  console.log(JSON.stringify({steady:report.result,drain:report.drain?.result,processing:report.processing}));
}
