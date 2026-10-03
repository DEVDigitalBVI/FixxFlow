import assert from 'node:assert/strict';
import test from 'node:test';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { definition, group, action, rule, event, uuid } from '../../../tests/fixtures/automation.mjs';
import { seed, ids, owner, identity, service, activate, createRule, ticket, storeFor, runAutomationWorker } from '../../../tests/helpers/automation-worker.mjs';

const oversized = definition({ conditions: group(), actions: Array.from({length:5}, (_,i)=>action('add_internal_note',{body:'界'.repeat(18000)},i)) });
const temporal = {...oversized,trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:1}}};
const {persistenceRegistry}=load('src/features/automation/persistence-contract.ts');
const {validateDefinition,validateStoredDefinition}=load('src/features/automation/validation.ts');
const {planAutomation,planStoredAutomation}=load('src/features/automation/planner.ts');

test('legacy read/planning retains bounded structure; draft planning cannot bypass the write ceiling',()=>{
 assert.equal(validateDefinition(oversized,persistenceRegistry).issues[0].code,'definition_limit_exceeded');
 assert.equal(validateStoredDefinition(oversized,persistenceRegistry).valid,true);
 assert.equal(planAutomation(rule({definition:oversized}),event(),persistenceRegistry,event().organizationId).status,'invalid_rule');
 assert.equal(planStoredAutomation(rule({definition:oversized}),event(),persistenceRegistry,event().organizationId).status,'ready');
 for(const invalid of [{...oversized,name:'x'.repeat(121)},{...oversized,actions:[action('add_internal_note',{body:'x'.repeat(20001)})]}]) assert.equal(validateStoredDefinition(invalid,persistenceRegistry).valid,false);
});

test('saved-version dry run explains the byte limit and remains side-effect free',async()=>{
 const {DryRunReadError}=load('src/features/automation/dry-run-repository.ts',{'server-only':{}});
 const {testAutomation}=load('src/features/automation/dry-run-service.ts',{
  'server-only':{},'@/lib/auth/viewer':{requireViewer:async()=>({role:'administrator',status:'active',organizationId:ids.org})},
  '@/lib/supabase/server':{createClient:async()=>({})},
  './dry-run-repository':{DryRunReadError,dryRunRepository:()=>({read:async()=>{throw new DryRunReadError('FF004');}})},
 });
 const result=await testAutomation({ticketId:ids.org,definition:{kind:'version',ruleId:ids.org,version:2},source:{kind:'current_ticket'}});
 assert.equal(result.error.code,'definition_limit_exceeded');assert.match(result.error.message,/256 KiB/);assert.equal(result.sideEffectsPerformed,false);
});

async function denied(db,sql,args,code='FF004') {
 await db.exec('savepoint denied');
 try { await assert.rejects(db.query(sql,args),{code}); }
 finally { await db.exec('rollback to savepoint denied;release savepoint denied'); }
}
test('Stage 12 corrective upgrade preserves legacy configuration, administration and execution',async t=>{
 const legacy=[];let versions;
 const db=await migratedPostgres({beforeMigration:async(database,file)=>{
  if(!file.endsWith('_automation_guardrails.sql'))return;
  await database.exec('begin');await seed(database);
  for(const [tenant,actor,draft] of [[ids.org,ids.admin,oversized],[ids.org,ids.admin,temporal],[ids.otherOrg,ids.otherAdmin,{...temporal,actions:[action('add_internal_note',{body:'Healthy'})]}]]){
   await identity(database,'authenticated',actor);
   let r=(await database.query('select * from public.create_automation_rule($1,$2)',[tenant,draft])).rows[0];
   r=(await database.query('select * from public.set_automation_rule_enabled($1,$2,$3,true)',[tenant,r.id,r.version])).rows[0];legacy.push(r);
  }
  await owner(database);versions=(await database.query('select * from public.automation_rule_versions order by rule_id,version')).rows;
  await database.exec('commit');
 }});
 const scenario=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');await owner(db);}});
 try{
  await scenario('migration preserves all immutable versions and processing OFF',async()=>{
   assert.deepEqual((await db.query('select * from public.automation_rule_versions order by rule_id,version')).rows,versions);
   assert.equal((await db.query('select active from private.automation_processing_state')).rows[0].active,false);
  });
  await scenario('disable/archive succeed; reenable/create/edit/duplicate above ceiling remain denied',async()=>{
   await identity(db);
   const disabled=(await db.query('select * from public.set_automation_rule_enabled($1,$2,$3,false)',[ids.org,legacy[0].id,2])).rows[0];
   assert.equal(disabled.enabled,false);assert.deepEqual(disabled.definition,legacy[0].definition);
   await denied(db,'select public.set_automation_rule_enabled($1,$2,$3,true)',[ids.org,disabled.id,disabled.version]);
   await denied(db,'select public.create_automation_rule($1,$2)',[ids.org,oversized]);
   await denied(db,'select public.update_automation_rule($1,$2,$3,$4)',[ids.org,disabled.id,disabled.version,{...oversized,name:'Still oversized'}]);
   await denied(db,'select public.duplicate_automation_rule($1,$2,$3,$4)',[ids.org,disabled.id,disabled.version,'Copy']);
   const archived=(await db.query('select * from public.archive_automation_rule($1,$2,$3)',[ids.org,legacy[1].id,2])).rows[0];
   assert.equal(archived.enabled,false);assert.ok(archived.archived_at);
   const edited=(await db.query('select * from public.update_automation_rule($1,$2,$3,$4)',[ids.org,disabled.id,disabled.version,definition({conditions:group()})])).rows[0];
   assert.equal((await db.query('select * from public.set_automation_rule_enabled($1,$2,$3,true)',[ids.org,edited.id,edited.version])).rows[0].enabled,true);
  });
  await scenario('stored oversized rules and versions are readable through the repository',async()=>{
   const {automationRepository}=load('src/features/automation/repository.ts',{'server-only':{}});
   let versionRead=false;
   const client={from(table){let q;const data=JSON.parse(JSON.stringify(table==='automation_rules'?legacy[0]:versions.filter(v=>v.rule_id===legacy[0].id))); q={select(){return q;},eq(){return q;},order(){return q;},range(){versionRead=true;return Promise.resolve({data,error:null});},maybeSingle(){return Promise.resolve({data,error:null});}};return q;}};
   const repo=automationRepository(client,ids.org);
   assert.deepEqual((await repo.get(legacy[0].id)).rule.definition,oversized);
   assert.equal((await repo.versions(legacy[0].id,1)).length,2);assert.equal(versionRead,true);
  });
  await scenario('legacy worker interruption resumes pinned actions without repeating completed notes',async()=>{
   await activate(db);await ticket(db);await service(db);
   const store=storeFor(db),[delivery]=await store.claim(),[candidate]=await store.discover(delivery,null);
   const execution=await store.begin(delivery,candidate.rule);
   await store.execute(delivery,execution,candidate.rule.definition.actions[0]);
   await store.finish(delivery,'retry','transient_failure');
   await owner(db);await db.exec("update private.domain_event_deliveries set available_at=clock_timestamp() where status='pending'");await service(db);
   assert.equal((await runAutomationWorker(store,{enabled:true})).acknowledged,1);
   await owner(db);assert.equal((await db.query('select count(*)::int n from public.ticket_messages')).rows[0].n,5);
   assert.equal((await db.query('select max(attempts) n from public.automation_execution_steps')).rows[0].n,1);
  });
  await scenario('legacy temporal rules do not block another tenant; cursors commit and deduplicate',async()=>{
   await activate(db);await owner(db);
   await db.exec("update private.automation_processing_state set activated_at=clock_timestamp()-interval '5 minutes'");
   for(const [tenant,actor] of [[ids.org,ids.admin],[ids.otherOrg,ids.otherAdmin]]){
    await identity(db,'authenticated',actor);await owner(db);
    await db.query("update public.automation_rules set enabled_at=clock_timestamp()-interval '5 minutes' where organization_id=$1",[tenant]);
    await db.query("insert into public.tickets(organization_id,requester_id,title,description,created_at) values($1,$2,'Temporal correction','Synthetic',clock_timestamp()-interval '60 seconds')",[tenant,actor]);
   }
   await service(db);const result=(await db.query('select public.discover_temporal_automation() r')).rows[0].r;
   assert.equal(result.rules,2);assert.equal(result.emitted,2);
   assert.equal((await db.query('select public.discover_temporal_automation() r')).rows[0].r.emitted,0);
   await owner(db);assert.equal((await db.query('select count(distinct organization_id)::int n from private.automation_temporal_cursors')).rows[0].n,2);
  });
  await scenario('new direct privileged writes cannot evade the byte policy',async()=>{
   await owner(db);
   await denied(db,'insert into public.automation_rules(organization_id,definition,created_by,updated_by) values($1,$2,$3,$3)',[ids.org,oversized,ids.admin]);
  });
 }finally{await db.close();}
});

test('Stage 12 corrected scheduling and Operations classifications',async t=>{
 const db=await migratedPostgres();
 const scenario=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await seed(db);await fn();}finally{await db.exec('rollback');await owner(db);}});
 try{
  await scenario('one inactive tenant cannot waste a healthy tenant’s delivery slots',async()=>{
   await ticket(db);await createRule(db,{tenant:ids.otherOrg,actions:[action('add_internal_note',{body:'Work'})]});await activate(db);
   for(let i=0;i<20;i++)await ticket(db,ids.otherOrg);await service(db);
   for(let i=0;i<4;i++)assert.equal((await runAutomationWorker(storeFor(db),{enabled:true})).acknowledged,5);
  });
  await scenario('long ineligible prefix advances once per invocation and preserves smaller-tenant progress',async()=>{
   await identity(db);await db.query("insert into public.tickets(organization_id,requester_id,title,description) select $1,$2,'Old '||n,'Synthetic' from generate_series(1,240)n",[ids.org,ids.employee]);
   await createRule(db,{actions:[action('add_internal_note',{body:'Large'})]});await createRule(db,{tenant:ids.otherOrg,actions:[action('add_internal_note',{body:'Small'})]});await activate(db);
   await ticket(db);const small=await ticket(db,ids.otherOrg);await service(db);
   assert.equal((await runAutomationWorker(storeFor(db),{enabled:true})).acknowledged,1);
   await owner(db);assert.equal((await db.query('select count(*)::int n from public.automation_executions where entity_id=$1',[small.id])).rows[0].n,1);
   await service(db);await runAutomationWorker(storeFor(db),{enabled:true});assert.equal((await runAutomationWorker(storeFor(db),{enabled:true})).acknowledged,1);
  });
  await scenario('many inactive tenants respect the visit bound and healthy work still progresses',async()=>{
   for(let n=1;n<=30;n++){
    const tenant=uuid(9000+n);await owner(db);
    await db.query("insert into public.organizations(id,name,slug)values($1,'Inactive tenant',$2)",[tenant,`inactive-${n}`]);
    await db.query("insert into public.organization_memberships(organization_id,user_id,role)values($1,$2,'administrator')",[tenant,ids.admin]);
    await identity(db);await db.query("insert into public.tickets(organization_id,requester_id,title,description)values($1,$2,'Historical','Synthetic')",[tenant,ids.admin]);
   }
   await createRule(db,{tenant:ids.otherOrg,actions:[action('add_internal_note',{body:'Progress'})]});await activate(db);const healthy=await ticket(db,ids.otherOrg);
   await service(db);await runAutomationWorker(storeFor(db),{enabled:true});await owner(db);
   assert.equal((await db.query("select count(*)::int n from private.automation_tenant_schedule where last_claimed_at>'-infinity'")).rows[0].n,20);
   for(let n=0;n<3;n++){await service(db);await runAutomationWorker(storeFor(db),{enabled:true});}
   await owner(db);assert.equal((await db.query('select count(*)::int n from public.ticket_messages where ticket_id=$1',[healthy.id])).rows[0].n,1);
  });
  await scenario('retry backlog beyond a candidate page cannot starve fresh work or another tenant',async()=>{
   await createRule(db,{actions:[action('add_internal_note',{body:'Recovered'})]});await createRule(db,{tenant:ids.otherOrg,actions:[action('add_internal_note',{body:'Small'})]});await activate(db);
   await identity(db);await db.query("insert into public.tickets(organization_id,requester_id,title,description)select $1,$2,'Retry '||n,'Synthetic' from generate_series(1,120)n",[ids.org,ids.employee]);
   await owner(db);await db.query("update private.domain_event_deliveries set attempts=1 where organization_id=$1",[ids.org]);
   await db.query("insert into private.automation_capacity(organization_id,resource,window_started_at,used)values($1,'retryClaims',clock_timestamp(),5)",[ids.org]);
   const fresh=await ticket(db),small=await ticket(db,ids.otherOrg);await service(db);
   await runAutomationWorker(storeFor(db),{enabled:true});await owner(db);
   assert.equal((await db.query('select count(*)::int n from public.ticket_messages where ticket_id=$1',[small.id])).rows[0].n,1);
   for(let n=0;n<3;n++){await service(db);await runAutomationWorker(storeFor(db),{enabled:true});}
   await owner(db);assert.equal((await db.query('select count(*)::int n from public.ticket_messages where ticket_id=$1',[fresh.id])).rows[0].n,1);
   assert.equal((await db.query("select count(*)::int n from private.domain_event_deliveries where organization_id=$1 and status='pending' and attempts=1",[ids.org])).rows[0].n,120);
  });
  await scenario('notification safety outcomes agree across summary and every history filter',async()=>{
   await owner(db);await db.exec("insert into auth.users(id,email) select ('90000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'guard'||n||'@example.invalid' from generate_series(1,121)n");
   await db.query("insert into public.organization_memberships(organization_id,user_id,role) select $1,id,'technician' from auth.users where id::text like '90000000-%'",[ids.org]);
   await createRule(db,{actions:[action('set_status',{status:'open'})]});await activate(db);await identity(db);
   await db.query("insert into public.tickets(organization_id,requester_id,title,description,status) values($1,$2,'Reopen','Synthetic','resolved')",[ids.org,ids.employee]);await service(db);await runAutomationWorker(storeFor(db),{enabled:true});
   await identity(db);const view=(await db.query('select public.read_automation_operations($1) r',[ids.org])).rows[0].r;
   assert.equal(view.executions.guardrailTerminated,1);assert.equal(view.executions.actionFailed,0);
   for(const [filter,count] of [['guardrail',1],['failures',1],['all',1],['action_failed',0],['retry_exhausted',0]]){
    const result=(await db.query("select public.read_automation_operations_history($1,result_filter=>$2,until_at=>clock_timestamp()+interval '1 second') r",[ids.org,filter])).rows[0].r;
    assert.equal(result.rows.length,count,filter);
   }
  });
  await scenario('chain admission termination is visible separately from ordinary delivery failure',async()=>{
   await createRule(db,{trigger:'ticket.priority_changed',actions:[action('set_priority',{priority:'critical'})]});await activate(db);
   const target=await ticket(db);await db.query("update public.tickets set priority='high' where id=$1",[target.id]);await service(db);
   await runAutomationWorker(storeFor(db),{enabled:true});await runAutomationWorker(storeFor(db),{enabled:true});
   await identity(db);const queue=(await db.query('select public.read_automation_operations($1) r',[ids.org])).rows[0].r.queue;
   assert.equal(queue.recent.guardrailTerminated,1);assert.equal(queue.recent.failed,0);
  });
 }finally{await db.close();}
});
