/** Real-time short SLA window and bounded temporal fairness; isolated Docker. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {service,sql,json,literal,ok} from './automation-stage12c-recovery-env.mjs';
import {definition,action,group} from '../fixtures/automation.mjs';
import {load} from './load-module.mjs';
const {runAutomationWorker}=load('src/features/automation/worker.ts',{'server-only':{}});
const {automationWorkerRepository}=load('src/features/automation/worker-repository.ts',{'server-only':{}});
assert.equal(sql('select active from private.automation_processing_state'),'f');
const orgs=[randomUUID(),randomUUID()];
const admin=ok(await service.auth.admin.createUser({email:`stage12c-temporal-${randomUUID()}@example.invalid`,email_confirm:true})).user.id;
const identity=`set local role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify({sub:admin,role:'authenticated',aal:'aal1'}))},true);`;
for(const [i,org] of orgs.entries()) {
  sql(`insert into public.organizations(id,name,slug)values('${org}','Stage12C temporal ${i}','temporal-${org}');insert into public.organization_memberships(organization_id,user_id,role)values('${org}','${admin}','administrator');`);
  const draft=definition({conditions:group(),trigger:i===0?{type:'ticket.open_duration_reached',configuration:{durationMinutes:1}}:{type:'ticket.sla_approaching',configuration:{durationMinutes:1,objective:'response'}},actions:[action('add_internal_note',{body:'Synthetic temporal receipt'})]});
  sql(`begin;${identity}do $$declare r public.automation_rules;begin r:=public.create_automation_rule('${org}',${json(draft)});perform public.set_automation_rule_enabled('${org}',r.id,1,true);end $$;commit;`);
}
const counts=()=>sql(`select count(*) from private.automation_temporal_occurrences where organization_id in ('${orgs.join("','")}')`);
const discover=async()=>{
  const value=ok(await service.rpc('discover_temporal_automation',{}));
  assert.ok(value.rules<=5);assert.ok(value.examined<=500);assert.ok(value.emitted<=500);return value;
};
function slaTicket(seconds) {
  const id=sql(`begin;${identity}insert into public.tickets(organization_id,requester_id,title,description)values('${orgs[1]}','${admin}','Synthetic SLA window','Synthetic')returning id;commit;`).split('\n').at(-1);
  // Fixture-only future deadline; no runtime clock/cursor/activation is aged.
  // Restore the SLA trigger within the same transaction before any discovery.
  sql(`begin;alter table public.tickets disable trigger tickets_sla_prepare;update public.tickets set response_sla_due_at=clock_timestamp()+interval '${seconds} seconds' where id='${id}';alter table public.tickets enable trigger tickets_sla_prepare;commit;`);
  return id;
}
const report={engine:sql('show server_version'),scope:'Local PostgREST, real elapsed windows; synthetic future SLA deadline; immediate extra calls test cursor correctness, not scheduled throughput',startedAt:new Date().toISOString()};
try {
  assert.equal(ok(await service.rpc('discover_temporal_automation',{})).emitted,0);
  sql('select private.set_automation_processing(true)');
  sql(`begin;${identity}insert into public.tickets(organization_id,requester_id,title,description)select '${orgs[0]}','${admin}','Temporal large '||n,'Synthetic'from generate_series(1,210)n;commit;`);
  const timely=slaTicket(90);
  console.log('Waiting for real one-minute open threshold and short SLA approaching window');
  await delay(61000);
  const before=counts();sql('begin;set local role service_role;select public.discover_temporal_automation();rollback;');assert.equal(counts(),before);
  report.discovery=[await discover()];
  assert.equal(sql(`select count(*) from private.automation_temporal_occurrences where organization_id='${orgs[1]}' and entity_id='${timely}'`),'1');
  for(let i=0;i<3;i++)report.discovery.push(await discover());
  assert.equal(counts(),'211');assert.equal(report.discovery.at(-1).emitted,0);
  report.cursorRollbackRecovery='PASS';report.smallTenantProgress='PASS';report.occurrenceIdempotency='PASS';
  report.worker=[];
  for(let i=0;i<10;i++) {
    report.worker.push(await runAutomationWorker(automationWorkerRepository(service),{enabled:true}));
    if(sql(`select count(*)from public.automation_executions where organization_id='${orgs[1]}'and status='succeeded'`)==='1')break;
  }
  assert.equal(sql(`select count(*)from public.automation_executions where organization_id='${orgs[1]}'and status='succeeded'`),'1');
  const missed=slaTicket(65);
  console.log('PASS timely window and small-tenant execution; deliberately pausing discovery past a new deadline');
  await delay(70000);await discover();
  assert.equal(sql(`select count(*)from private.automation_missed_windows where organization_id='${orgs[1]}'and entity_id='${missed}'`),'1');
  assert.equal(sql(`select count(*)from private.automation_temporal_occurrences where organization_id='${orgs[1]}'and entity_id='${missed}'`),'0');
  report.operations=JSON.parse(sql(`begin;${identity}select public.read_automation_operations('${orgs[1]}');commit;`).split('\n').at(-1));
  assert.equal(report.operations.lag.missedWindow,1);assert.equal(report.operations.lag.sampled,1);
  report.missedWindowObservable='PASS';report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.message;throw error;}
finally {
  sql('select private.set_automation_processing(false)');
  assert.equal(ok(await service.rpc('discover_temporal_automation',{})).emitted,0);
  report.processing='OFF';report.finishedAt=new Date().toISOString();
  writeFileSync('/tmp/fixxflow-stage12c-temporal-results.json',JSON.stringify(report,null,2));
}
console.log('PASS temporal bounds, fairness, real short SLA windows, missed observations and OFF control');
