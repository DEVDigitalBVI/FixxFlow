/** Read-only log/provenance checks. Never print credential or content values. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {local,sql,literal,container} from './automation-stage12c-local.mjs';
const run=JSON.parse(readFileSync('/tmp/fixxflow-stage12c-capacity-results.json','utf8'));
const session=JSON.parse(readFileSync('/tmp/fixxflow-stage12c-test-session.json','utf8'));
const app=readFileSync('/tmp/fixxflow-stage12c-app-server.private','utf8');
const databaseLog=spawnSync('docker',['logs',container],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
assert.equal(databaseLog.status,0);
const database=databaseLog.stdout+databaseLog.stderr;
const forbidden=[local.SERVICE_ROLE_KEY,readFileSync('/tmp/fixxflow-stage12c-cron.private','utf8'),session.mfa.secret,...session.users.map(u=>u.password),'Synthetic Stage12C secret body must not enter telemetry','Synthetic Stage12C capacity note','Synthetic verification note.'];
const report={scope:'Local Next server log and PostgreSQL stdout/stderr log sample; not provider-wide log sinks',checkedAt:new Date().toISOString(),logs:{}};
for(const [name,text]of Object.entries({app,database})){
  assert.ok(forbidden.every(value=>value&&!text.includes(value)),`${name}: sensitive canary found (value withheld)`);
  report.logs[name]={bytes:Buffer.byteLength(text),sensitiveCanariesAbsent:true};
}
const logs=app.split('\n').flatMap(line=>{try {const value=JSON.parse(line);return value&&typeof value==='object'?[value]:[];}catch{return [];}});
const allowed=new Set(['component','deliveryId','eventId','eventType','organizationId','correlationId','ruleId','ruleVersion','executionId','stepId','actionId','actionPosition','result','code']);
const worker=logs.filter(row=>row.component==='automation');
for(const row of worker)for(const key of Object.keys(row))assert.ok(allowed.has(key),`Unexpected worker log key: ${key}`);
assert.ok(worker.some(row=>row.stepId&&row.executionId&&row.ruleId&&row.ruleVersion&&row.deliveryId&&row.eventId&&row.correlationId));
const ids=run.tenants.map(literal).join(',');
report.trace=JSON.parse(sql(`select jsonb_build_object('eventId',e.id,'deliveryId',d.id,'ruleId',v.rule_id,'ruleVersion',v.version,'executionId',x.id,'stepId',s.id,'correlationId',e.correlation_id,'rootEventId',e.root_event_id,'causationId',e.causation_id,'status',x.status)from public.automation_executions x join private.domain_events e on(e.organization_id,e.id)=(x.organization_id,x.event_id)join private.domain_event_deliveries d on(d.organization_id,d.id)=(x.organization_id,x.delivery_id)join public.automation_rule_versions v on(v.organization_id,v.rule_id,v.version)=(x.organization_id,x.rule_id,x.rule_version)join public.automation_execution_steps s on(s.organization_id,s.execution_id)=(x.organization_id,x.id)where x.organization_id in(${ids})and x.status='succeeded'limit 1`));
assert.ok(worker.some(row=>row.stepId===report.trace.stepId&&row.executionId===report.trace.executionId&&row.correlationId===report.trace.correlationId));
report.workerLogEntries=worker.length;report.safeActionTrace='PASS';
report.invocations=JSON.parse(sql(`select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'startedAt',started_at,'outcome',outcome))from(select *from private.automation_runs order by started_at desc limit 2)r`));
report.workerInvocationLink='PARTIAL: worker step logs omit the automation_runs UUID; associate by bounded invocation time, not an exact persisted foreign key';
report.discoveryInvocationIds=run.samples.map(s=>s.discovery.result.invocationId).filter(Boolean);
report.externalLogSinks='Not inspected; no hosted environment';
writeFileSync('/tmp/fixxflow-stage12c-observability-results.json',JSON.stringify(report,null,2));
console.log('PASS sensitive canaries absent and persisted action identifiers match worker logs; invocation association remains PARTIAL');
