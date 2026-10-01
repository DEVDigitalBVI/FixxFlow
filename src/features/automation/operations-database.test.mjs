import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { ids,seed,owner,identity,service,ticket,createRule,activate,storeFor,runAutomationWorker,tick } from '../../../tests/helpers/automation-worker.mjs';
import { definition,action,group,uuid } from '../../../tests/fixtures/automation.mjs';
const overview=async(db,org=ids.org)=>(await db.query('select public.read_automation_operations($1) value',[org])).rows[0].value;
const history=async(db,args={})=>(await db.query('select public.read_automation_operations_history($1,$2,$3,$4,$5,$6,$7,$8,$9) value',[args.org??ids.org,args.query??'',args.trigger??'',args.result??'all',args.since??null,args.until??null,args.before??null,args.cursor??null,args.ticket??null])).rows[0].value;
async function denied(db,sql,args=[],code='42501'){await db.exec('savepoint denial');await assert.rejects(db.query(sql,args),e=>e.code===code);await db.exec('rollback to savepoint denial;release savepoint denial');}
async function snapshot(db){await owner(db);const result={};for(const table of ['audit_events','tickets','ticket_messages','ticket_activity','automation_executions','automation_execution_steps'])result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') data from public.${table} t`)).rows[0].data;return result;}

test('Stage 10 durable health and bounded tenant operational reads',async t=>{
 const db=await migratedPostgres();const scenario=(name,fn)=>t.test(name,async()=>{await db.exec('begin');await seed(db);try{await fn();}finally{await db.exec('rollback');}});
 try{
  await scenario('empty/OFF read is safe, tenant scoped and creates no audit or ticket changes',async()=>{
   const before=await snapshot(db);await identity(db);const data=await overview(db);assert.equal(data.processingActive,false);assert.equal(data.worker.lastSuccessfulAt,null);assert.equal(data.executions.total,0);assert.equal(data.queue.sampled,0);assert.equal(data.temporalRules.length,0);assert.deepEqual((await history(db)).rows,[]);assert.deepEqual(await snapshot(db),before);
  });
  await scenario('administrator allowed; technicians, end users, platform-only, MFA and cross-tenant access denied',async()=>{
   await identity(db);await overview(db);await denied(db,'select public.read_automation_operations($1)',[ids.otherOrg]);await denied(db,'select public.read_automation_operations_history($1)',[ids.otherOrg]);
   for(const [role,user] of [['authenticated',ids.worker],['authenticated',ids.employee],['anon',ids.admin],['service_role',ids.admin],['authenticated',uuid(777)]]){await identity(db,role,user);await denied(db,'select public.read_automation_operations($1)',[ids.org]);await denied(db,'select public.read_automation_operations_history($1)',[ids.org]);}
   await owner(db);await db.query("insert into auth.mfa_factors(id,user_id,factor_type,status) values(gen_random_uuid(),$1,'totp','verified')",[ids.admin]);await identity(db);await denied(db,'select public.read_automation_operations($1)',[ids.org]);
   await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.admin,role:'authenticated',aal:'aal2'})]);assert.equal((await overview(db)).processingActive,false);
  });
  await scenario('service heartbeat finish is bounded, idempotent, overlapping-safe and platform counts never leak',async()=>{
   await identity(db);await denied(db,"select public.start_automation_run('worker')");
   for(const table of ['automation_runs','automation_missed_windows'])await denied(db,`select * from private.${table}`);
   await service(db);const first=(await db.query("select public.start_automation_run('worker') id")).rows[0].id;await tick();const second=(await db.query("select public.start_automation_run('worker') id")).rows[0].id;
   await db.query("select public.finish_automation_run($1,'succeeded',$2)",[second,{claimed:999,executions:888}]);
   await db.query("select public.finish_automation_run($1,'failed',$2)",[first,{failures:1}]);
   assert.equal((await db.query("select public.finish_automation_run($1,'succeeded',$2) ok",[second,{claimed:999,executions:888}])).rows[0].ok,true);
   assert.equal((await db.query("select public.finish_automation_run($1,'failed','{}') ok",[second])).rows[0].ok,false);
   await denied(db,"select public.finish_automation_run($1,'failed','{\"body\":\"SECRET\"}')",[second],'22023');
   await denied(db,"select public.finish_automation_run($1,'failed','{\"failures\":-1}')",[second],'22023');
   const discovery=(await db.query("select public.start_automation_run('discovery') id")).rows[0].id;await db.query("select public.finish_automation_run($1,'failed','{\"failures\":1}')",[discovery]);
   await identity(db);const result=await overview(db);assert.equal(result.worker.latestCompletedResult,'succeeded');assert.equal(result.discovery.latestCompletedResult,'failed');
   assert.doesNotMatch(JSON.stringify(result),/999|888|SECRET|metrics|claimed|invocationId/);assert.equal(result.executions.total,0);
  });
  await scenario('queue states, retries, oldest work, completion and exhaustion are distinguished',async()=>{
   await activate(db);await createRule(db);const targets=[];for(let i=0;i<5;i++)targets.push(await ticket(db));await service(db);
   const leased=(await db.query('select * from public.claim_automation_events(3,120)')).rows;assert.equal(leased.length,3);
   await db.query("select public.finish_domain_event_delivery($1,$2,'retry','transient_failure')",[leased[0].delivery_id,leased[0].lease_token]);
   await db.query("select public.finish_domain_event_delivery($1,$2,'failed','permanent_failure')",[leased[1].delivery_id,leased[1].lease_token]);
   await identity(db);const q=(await overview(db)).queue;assert.equal(q.ready,2);assert.equal(q.leased,1);assert.equal(q.retryScheduled,1);assert.equal(q.recent.failed,1);assert.ok(q.oldestEligibleAt);
   await owner(db);await db.query("update private.domain_event_deliveries set attempts=8,status='dead',completed_at=clock_timestamp(),error_code='retry_exhausted',leased_at=null,lease_expires_at=null where id=$1",[leased[0].delivery_id]);
   await identity(db);assert.equal((await overview(db)).queue.recent.exhausted,1);
  });
  await scenario('global history filters, cursor pages, immutable names and execution counts stay tenant scoped',async()=>{
   await activate(db);const rule=await createRule(db);await createRule(db,{tenant:ids.otherOrg});
   for(let i=0;i<53;i++)await ticket(db);await ticket(db,ids.otherOrg);
   await service(db);for(let i=0;i<12;i++)await runAutomationWorker(storeFor(db),{enabled:true,log(){}});
   await identity(db);const first=await history(db);assert.equal(first.rows.length,50);assert.equal(first.hasNext,true);assert.equal(new Set(first.rows.map(r=>r.id)).size,50);
   const last=first.rows.at(-1),second=await history(db,{before:last.started_at,cursor:last.id,since:first.since,until:first.until});assert.equal(second.rows.length,3);assert.equal(second.hasNext,false);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,53);
   const target=first.rows[0];assert.equal((await history(db,{ticket:target.ticket_number})).rows.length,1);assert.equal((await history(db,{trigger:'ticket.resolved'})).rows.length,0);
   assert.equal((await history(db,{query:'requests'})).rows.length,50);assert.equal((await history(db,{query:'%'})).rows.length,0);
   await db.query('select public.update_automation_rule($1,$2,$3,$4)',[ids.org,rule.id,rule.version,definition({name:'Renamed today',conditions:group()})]);assert.equal((await history(db)).rows[0].rule_name,'Route requests');
   await owner(db);await db.query("update public.automation_executions set status='failed',error_code='retry_exhausted' where id=$1",[target.id]);
   await identity(db);assert.equal((await history(db,{result:'retry_exhausted'})).rows.length,1);assert.equal((await history(db,{result:'failures'})).rows.length,1);assert.equal((await history(db,{result:'action_failed'})).rows.length,0);
   const totals=(await overview(db)).executions;assert.equal(totals.total,53);assert.equal(totals.completed,52);assert.equal(totals.retryExhausted,1);
   await denied(db,'select public.read_automation_operations_history($1,since_at=>$2,until_at=>$3)',[ids.org,'2026-01-01','2026-12-01'],'22023');
  });
  await scenario('discovery lag, missed SLA windows, deduplication and tenant progress are observational only',async()=>{
   await activate(db);await identity(db);
   let rule=(await db.query('select * from public.create_automation_rule($1,$2)',[ids.org,definition({trigger:{type:'ticket.sla_approaching',configuration:{durationMinutes:5,objective:'resolution'}},conditions:group(),actions:[action('add_internal_note',{body:'Safe fixture'})]})])).rows[0];
   rule=(await db.query('select * from public.set_automation_rule_enabled($1,$2,$3,true)',[ids.org,rule.id,rule.version])).rows[0];
   const targets=[];for(let i=0;i<3;i++)targets.push(await ticket(db));const foreign=await ticket(db,ids.otherOrg);
   // Only the isolated fixture advances eligibility clocks; runtime never does.
   await owner(db);await db.exec("update private.automation_processing_state set activated_at=clock_timestamp()-interval '1 hour';update public.automation_rules set enabled_at=clock_timestamp()-interval '1 hour';alter table public.automation_rule_versions disable trigger automation_versions_immutable;update public.automation_rule_versions set created_at=clock_timestamp()-interval '1 hour';alter table public.automation_rule_versions enable trigger automation_versions_immutable;alter table public.tickets disable trigger tickets_sla_prepare");
   for(const [i,minutes] of [4.5,3,-1].entries())await db.query("update public.tickets set resolution_sla_due_at=clock_timestamp()+$2*interval '1 minute' where id=$1",[targets[i].id,minutes]);
   await db.query("update public.tickets set resolution_sla_due_at=clock_timestamp()-interval '1 minute' where id=$1",[foreign.id]);await db.exec('alter table public.tickets enable trigger tickets_sla_prepare');
   const discover=async()=>{await service(db);return(await db.query('select public.discover_temporal_automation() result')).rows[0].result;};
   assert.equal((await discover()).emitted,2);assert.equal((await discover()).emitted,0);
   await identity(db);const data=await overview(db);assert.equal(data.lag.sampled,2);assert.equal(data.lag.withinWindow,1);assert.equal(data.lag.lateBeforeDeadline,1);assert.equal(data.lag.missedWindow,1);assert.ok(data.lag.maxSeconds>=120);assert.ok(data.lag.maxSeconds<125);assert.ok(data.temporalRules[0].lastScannedAt);assert.equal(data.temporalRules[0].id,rule.id);
   await identity(db,'authenticated',ids.otherAdmin);const other=await overview(db,ids.otherOrg);assert.equal(other.lag.sampled,0);assert.equal(other.lag.missedWindow,0);assert.equal(other.temporalRules.length,0);
   await owner(db);assert.equal((await db.query('select count(*)::int n from private.automation_missed_windows')).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from public.automation_executions')).rows[0].n,0);
   // A useful event already emitted must not be reclassified as missed once
   // the SAME authoritative deadline passes on a subsequent discovery.
   const near=await ticket(db);await owner(db);await db.exec('alter table public.tickets disable trigger tickets_sla_prepare');
   await db.query("update public.tickets set resolution_sla_due_at=clock_timestamp()+interval '1 second' where id=$1",[near.id]);await db.exec('alter table public.tickets enable trigger tickets_sla_prepare');
   assert.equal((await discover()).emitted,1);await new Promise(resolve=>setTimeout(resolve,1100));assert.equal((await discover()).emitted,0);
   await identity(db);assert.equal((await overview(db)).lag.missedWindow,1);
   await identity(db);const before=await snapshot(db);await identity(db);await overview(db);await history(db);assert.deepEqual(await snapshot(db),before);
  });
  await scenario('queue summary has a hard candidate cap and labels incomplete data',async()=>{
   await owner(db);await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.admin,role:'authenticated',aal:'aal1'})]);
   await db.query("insert into public.tickets(organization_id,requester_id,title,description) select $1,$2,'Bounded queue '||i,'Fixture' from generate_series(1,1002) i",[ids.org,ids.employee]);
   await identity(db);const q=(await overview(db)).queue;assert.equal(q.sampled,1000);assert.equal(q.truncated,true);assert.equal(q.ineligiblePending,1000);
  });
 }finally{await db.close();}
});

 test('Stage 10 upgrade preserves existing ticket/runtime records and processing OFF',async()=>{
 let before;
 const db=await migratedPostgres({beforeMigration:async(db,name)=>{if(name!=='20261001165514_automation_operations.sql')return;await db.exec('begin');await seed(db);await createRule(db);await ticket(db);before=await snapshot(db);await db.exec('commit');}});
 try{await db.exec('begin');assert.deepEqual(await snapshot(db),before);await identity(db);assert.equal((await overview(db)).processingActive,false);await owner(db);assert.equal((await db.query('select count(*)::int n from private.automation_runs')).rows[0].n,0);}finally{await db.close();}
 });
