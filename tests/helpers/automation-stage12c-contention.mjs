/** Independent PostgREST requests + database connections. Local stack only. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {service,sql,connection,json,literal,ok} from './automation-stage12c-recovery-env.mjs';
import {definition,action,group} from '../fixtures/automation.mjs';
const org=randomUUID();
const admin=ok(await service.auth.admin.createUser({email:`stage12c-recovery-${randomUUID()}@example.invalid`,email_confirm:true})).user.id;
const identity=`set local role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify({sub:admin,role:'authenticated',aal:'aal1'}))},true);`;
const gates={};const pass=name=>{gates[name]='PASS';console.log(`PASS ${name}`);};
const draft=definition({conditions:group(),actions:[action('send_notification',{recipient:'requester',template:'ticket_update'})]});
sql(`insert into public.organizations(id,name,slug)values('${org}','Stage12C contention','contention-${org}');insert into public.organization_memberships(organization_id,user_id,role)values('${org}','${admin}','administrator');`);
const rule=JSON.parse(sql(`begin;${identity}select row_to_json(r) from public.create_automation_rule('${org}',${json(draft)})r;commit;`).split('\n').at(-1));
sql(`begin;${identity}select public.set_automation_rule_enabled('${org}','${rule.id}',1,true);commit;`);
const leasesFor=async(count)=>{
 sql(`begin;${identity}insert into public.tickets(organization_id,requester_id,title,description)select '${org}','${admin}','Contention '||n,'Synthetic' from generate_series(1,${count})n;commit;`);
 const found=[];
 for(let i=0;i<10&&found.length<count;i++)found.push(...ok(await service.rpc('claim_automation_events',{batch_size:5,lease_seconds:120})).filter(d=>d.event.organizationId===org));
 assert.equal(found.length,count);return found;
};
const begin=d=>service.rpc('begin_automation_execution',{delivery_id:d.delivery_id,token:d.lease_token,rule_id:rule.id,rule_version:2}).single();
const execute=(d,e)=>service.rpc('execute_automation_ticket_step',{execution_id:e.id,token:d.lease_token,command:{organizationId:org,entityId:e.entity_id,action:draft.actions[0]}}).single();
const capacity=(resource,used,subject='00000000-0000-0000-0000-000000000000')=>sql(`insert into private.automation_capacity(organization_id,resource,subject,window_started_at,used)values('${org}','${resource}','${subject}',clock_timestamp(),${used}) on conflict(organization_id,resource,subject)do update set used=excluded.used,window_started_at=excluded.window_started_at`);
try {
 assert.equal(sql('select active from private.automation_processing_state'),'f');sql('select private.set_automation_processing(true)');
 const leases=await leasesFor(2);assert.equal(leases.length,2);capacity('executions',119);
 const race=await Promise.all(leases.map(begin));assert.equal(race.filter(r=>r.error?.code==='FF002').length,1);assert.equal(race.filter(r=>!r.error).length,1);
 assert.equal(sql(`select used from private.automation_capacity where organization_id='${org}' and resource='executions'`),'120');
 const deferredIndex=race.findIndex(r=>r.error),deferred=leases[deferredIndex];
 ok(await service.rpc('finish_domain_event_delivery',{delivery_id:deferred.delivery_id,token:deferred.lease_token,outcome:'deferred',failure_code:'execution_deferred_capacity'}));
 assert.equal(sql(`select attempts from private.domain_event_deliveries where id='${deferred.delivery_id}'`),'0');
 pass('independent_execution_admission_120_and_capacity_attempt_refund');
 // Artificially age only this test's clock windows/availability; not throughput data.
 sql(`update private.automation_capacity set window_started_at=clock_timestamp()-interval '61 seconds' where organization_id='${org}' and resource='executions';update private.domain_event_deliveries set available_at=clock_timestamp()-interval '1 second' where id='${deferred.delivery_id}'`);
 const recovered=ok(await service.rpc('claim_automation_events',{batch_size:5,lease_seconds:120})).find(d=>d.delivery_id===deferred.delivery_id);assert.ok(recovered);
 assert.ok((await begin(deferred)).error);leases[deferredIndex]=recovered;
 const executions=await Promise.all(leases.map(async d=>ok(await begin(d))));
 capacity('recipientNotifications',19,admin);
 const notifyRace=await Promise.all(leases.map((d,i)=>execute(d,executions[i])));
 assert.equal(notifyRace.filter(r=>r.error?.code==='FF003').length,1);assert.equal(notifyRace.filter(r=>!r.error).length,1);
 assert.equal(sql(`select used from private.automation_capacity where organization_id='${org}' and resource='recipientNotifications'`),'20');
 const win=notifyRace.findIndex(r=>!r.error),lose=1-win;
 const before=sql(`select count(*) from public.notifications where organization_id='${org}'`);
 await Promise.all([execute(leases[win],executions[win]),execute(leases[win],executions[win])]).then(rs=>rs.forEach(ok));
 assert.equal(sql(`select count(*) from public.notifications where organization_id='${org}'`),before);
 assert.equal(sql(`select attempts from public.automation_execution_steps where execution_id='${executions[lose].id}'`),'0');
 pass('recipient_contention_20_duplicate_receipt_and_rollback');
 // Tenant capacity remains binding even when the recipient window has space.
 capacity('recipientNotifications',0,admin);capacity('notifications',120);
 assert.equal((await execute(leases[lose],executions[lose])).error?.code,'FF003');
 ok(await service.rpc('finish_domain_event_delivery',{delivery_id:leases[lose].delivery_id,token:leases[lose].lease_token,outcome:'deferred',failure_code:'notification_deferred_capacity'}));
 assert.equal(sql(`select attempts from private.domain_event_deliveries where id='${leases[lose].delivery_id}'`),'0');
 capacity('notifications',0);
 sql(`update private.domain_event_deliveries set available_at=clock_timestamp()-interval '1 second' where id='${leases[lose].delivery_id}'`);
 const resumed=ok(await service.rpc('claim_automation_events',{batch_size:5,lease_seconds:120})).find(d=>d.delivery_id===leases[lose].delivery_id);assert.ok(resumed);
 ok(await execute(resumed,executions[lose]));
 for(const d of [leases[win],resumed])ok(await service.rpc('finish_domain_event_delivery',{delivery_id:d.delivery_id,token:d.lease_token,outcome:'acknowledged'}));
 pass('tenant_notification_capacity_defer_resume_and_no_repeated_completed_action');
 // Real independent SQL connections overlap the same receipt under a row lock.
 const more=await leasesFor(1),e=ok(await begin(more[0]));
 const holding=connection(`begin;select id from private.domain_event_deliveries where id='${more[0].delivery_id}' for update;select 'LOCKED';select pg_sleep(1);commit;`);await holding.locked;
 const duplicates=await Promise.all([execute(more[0],e),execute(more[0],e)]);duplicates.forEach(ok);await holding.done;
 assert.equal(sql(`select attempts from public.automation_execution_steps where execution_id='${e.id}'`),'1');
 sql(`update private.domain_event_deliveries set leased_at=statement_timestamp()-interval '121 seconds',lease_expires_at=statement_timestamp()-interval '1 second',available_at=statement_timestamp()-interval '1 second' where id='${more[0].delivery_id}'`);
 let recoveredLease;
 for(let i=0;i<10&&!recoveredLease;i++)recoveredLease=ok(await service.rpc('claim_automation_events',{batch_size:5,lease_seconds:120})).find(d=>d.delivery_id===more[0].delivery_id);
 assert.ok(recoveredLease);assert.ok((await execute(more[0],e)).error);ok(await execute(recoveredLease,e));
 assert.equal(sql(`select attempts from public.automation_execution_steps where execution_id='${e.id}'`),'1');
 ok(await service.rpc('finish_domain_event_delivery',{delivery_id:recoveredLease.delivery_id,token:recoveredLease.lease_token,outcome:'acknowledged'}));
 pass('overlapping_connections_action_idempotency_and_expired_lease_recovery');
 const tenantLeases=await leasesFor(2),tenantExecutions=await Promise.all(tenantLeases.map(async d=>ok(await begin(d))));
 capacity('notifications',119);capacity('recipientNotifications',0,admin);
 const tenantRace=await Promise.all(tenantLeases.map((d,i)=>execute(d,tenantExecutions[i])));
 assert.equal(tenantRace.filter(r=>r.error?.code==='FF003').length,1);assert.equal(tenantRace.filter(r=>!r.error).length,1);
 assert.equal(sql(`select used from private.automation_capacity where organization_id='${org}' and resource='notifications'`),'120');
 capacity('notifications',0);
 for(const [i,d] of tenantLeases.entries()){ok(await execute(d,tenantExecutions[i]));ok(await service.rpc('finish_domain_event_delivery',{delivery_id:d.delivery_id,token:d.lease_token,outcome:'acknowledged'}));}
 pass('independent_tenant_notification_contention_120');
 const failed=(await leasesFor(1))[0],running=ok(await begin(failed));
 sql(`update private.domain_event_deliveries set attempts=8 where id='${failed.delivery_id}'`);
 ok(await service.rpc('finish_domain_event_delivery',{delivery_id:failed.delivery_id,token:failed.lease_token,outcome:'retry',failure_code:'transient_failure'}));
 assert.equal(sql(`select error_code from public.automation_executions where id='${running.id}'`),'retry_exhausted');
 assert.equal(sql(`select status from public.automation_executions where id='${running.id}'`),'failed');
 pass('retry_exhaustion_terminalizes_running_execution');
} finally {sql('select private.set_automation_processing(false)');}
writeFileSync('/tmp/fixxflow-stage12c-contention-results.json',JSON.stringify({engine:sql('show server_version'),gates,processing:'OFF'},null,2));
