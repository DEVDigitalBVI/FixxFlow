import assert from 'node:assert/strict';
import test from 'node:test';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { definition, action, condition, group } from '../../../tests/fixtures/automation.mjs';
import { ids, seed, owner, service, identity, activate, createRule, ticket, storeFor, runAutomationWorker } from '../../../tests/helpers/automation-worker.mjs';
const { validateDefinition }=load('src/features/automation/validation.ts');
const { persistenceRegistry }=load('src/features/automation/persistence-contract.ts');
const { automationSafetyLimits: limits }=load('src/features/automation/limits.ts');
const valid=d=>validateDefinition(d,persistenceRegistry).valid;
const conditions=n=>group(...Array.from({length:n},(_,i)=>condition('priority','equals','normal',`c${i}`)));
const actions=n=>Array.from({length:n},(_,i)=>action('add_internal_note',{body:'Note'},i));
for(const [name,at,over] of [
 ['conditions',definition({conditions:conditions(50)}),definition({conditions:conditions(51)})],
 ['actions',definition({actions:actions(20)}),definition({actions:actions(21)})],
 ['name',definition({name:'x'.repeat(120)}),definition({name:'x'.repeat(121)})],
 ['description',definition({description:'x'.repeat(2000)}),definition({description:'x'.repeat(2001)})],
 ['note',definition({actions:[action('add_internal_note',{body:'x'.repeat(20000)})]}),definition({actions:[action('add_internal_note',{body:'x'.repeat(20001)})]})],
 ['duration',definition({trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:525600}}}),definition({trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:525601}}})],
]) test(`Stage 12 ${name}: exact maximum accepted, one over rejected`,()=>{assert.equal(valid(at),true);assert.equal(valid(over),false);});
test('Stage 12 nesting remains a flat AND, not an expanded capability',()=>assert.equal(valid(definition({conditions:group(group())})),false));
function byteDefinition(bytes){
 const d=definition({actions:Array.from({length:5},(_,i)=>action('add_internal_note',{body:'界'.repeat(17400)},i))});
 d.description='';const current=Buffer.byteLength(JSON.stringify(d));d.description='x'.repeat(bytes-current);return d;
}
test('Stage 12 serialized UTF-8 boundary is exact and typed',()=>{
 assert.equal(valid(byteDefinition(262144)),true);
 assert.equal(validateDefinition(byteDefinition(262145),persistenceRegistry).issues[0].code,'definition_limit_exceeded');
});
async function fill(db,resource,used,tenant=ids.org,recipient='00000000-0000-0000-0000-000000000000'){
 await owner(db);await db.query('insert into private.automation_capacity(organization_id,resource,subject,window_started_at,used) values($1,$2,$3,clock_timestamp(),$4) on conflict(organization_id,resource,subject) do update set used=$4,window_started_at=clock_timestamp()',[tenant,resource,recipient,used]);await service(db);
}
async function recover(db){await owner(db);await db.exec("update private.automation_capacity set window_started_at=clock_timestamp()-interval '61 seconds'; update private.domain_event_deliveries set available_at=clock_timestamp()-interval '1 second' where status='pending'");await service(db);}
async function count(db,table){await owner(db);return (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;}
async function safeReject(db,sql,args,code){await db.exec('savepoint rejected');try{await assert.rejects(db.query(sql,args),{code});}finally{await db.exec('rollback to savepoint rejected; release savepoint rejected');}}
test('Stage 12 migrated durable guardrails',async t=>{
 const db=await migratedPostgres();
 const scenario=(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await seed(db);await fn();}finally{await db.exec('rollback');}});
 try{
 await scenario('SQL registry agrees with application defaults; processing stays OFF',async()=>{
  const policy=(await db.query('select private.automation_safety_limits() p')).rows[0].p;
  assert.deepEqual(policy,{...limits.throughput,definitionBytes:limits.structural.definitionBytes});
  assert.equal((await db.query('select active from private.automation_processing_state')).rows[0].active,false);
 });
 await scenario('SQL validates exact definition byte boundary before persistence',async()=>{
  for(const n of [262144,262145]){const d=byteDefinition(n);assert.equal((await db.query('select private.automation_definition_bytes($1) n',[d])).rows[0].n,n);await identity(db);if(n===262144)await db.query('select public.create_automation_rule($1,$2)',[ids.org,d]);else await safeReject(db,'select public.create_automation_rule($1,$2)',[ids.org,d],'FF004');await owner(db);}
 });
 await scenario('active below/exactly/above maximum, disabled/imported and archived exclusions',async()=>{
  const rules=[];for(let i=0;i<100;i++)rules.push(await createRule(db));
  const disabled=await createRule(db,{enabled:false});
  await safeReject(db,'select public.set_automation_rule_enabled($1,$2,$3,true)',[ids.org,disabled.id,disabled.version],'FF001');
  await db.query('select public.archive_automation_rule($1,$2,$3)',[ids.org,rules[0].id,rules[0].version]);
  await db.query('select public.set_automation_rule_enabled($1,$2,$3,true)',[ids.org,disabled.id,disabled.version]);
  assert.equal((await db.query('select count(*)::int n from public.automation_rules where enabled and archived_at is null')).rows[0].n,100);
  await createRule(db,{tenant:ids.otherOrg});
 });
 await scenario('execution capacity defers durably without retry, then resumes once',async()=>{
  await createRule(db,{actions:[action('add_internal_note',{body:'One note'})]});await activate(db);await ticket(db);await fill(db,'executions',120);
  const result=await runAutomationWorker(storeFor(db),{enabled:true});assert.equal(result.capacityDeferred,1);assert.equal(result.failed,0);assert.equal(result.retried,0);
  await owner(db);const before=(await db.query("select * from private.domain_event_deliveries where capacity_reason is not null")).rows[0];assert.equal(before.attempts,0);assert.equal(before.status,'pending');assert.equal(await count(db,'public.automation_executions'),0);
  await identity(db);const view=(await db.query('select public.read_automation_operations($1) r',[ids.org])).rows[0].r;assert.equal(view.queue.capacityDeferred,1);assert.equal(view.queue.retryScheduled,0);assert.ok(view.queue.oldestCapacityDeferredAt);
  await recover(db);assert.equal((await runAutomationWorker(storeFor(db),{enabled:true})).acknowledged,1);assert.equal(await count(db,'public.ticket_messages'),1);
 });
 for(const policy of [{}, {executions:'broken'}, {executions:0}]) await scenario(`malformed policy ${JSON.stringify(policy)} defers instead of destroying work`,async()=>{
  await createRule(db);await activate(db);await ticket(db);await owner(db);
  await db.exec(`create or replace function private.automation_safety_limits() returns jsonb language sql immutable set search_path='' as $$ select '${JSON.stringify({...limits.throughput,...policy,executions:policy.executions??null})}'::jsonb $$`);
  await service(db);const result=await runAutomationWorker(storeFor(db),{enabled:true});assert.equal(result.capacityDeferred,1);assert.equal(result.failed,0);await owner(db);assert.equal((await db.query("select count(*)::int n from private.domain_event_deliveries where capacity_reason='execution_deferred_capacity' and attempts=0")).rows[0].n,1);
 });
 await scenario('conditions that fail consume admission; repeat receipts do not',async()=>{
  await createRule(db,{conditions:group(condition('priority','equals','critical'))});await activate(db);await ticket(db);await service(db);const store=storeFor(db);const [d]=await store.claim();const [r]=await store.discover(d,null);await store.begin(d,r.rule);await store.begin(d,r.rule);await owner(db);assert.equal((await db.query("select used from private.automation_capacity where resource='executions'")).rows[0].used,1);
 });
 for(const resource of ['notifications','recipientNotifications']) await scenario(`${resource} delay preserves notification/action and duplicate receipts cost zero`,async()=>{
  await createRule(db,{actions:[action('send_notification',{recipient:'requester',template:'ticket_update'})]});await activate(db);await ticket(db);
  await fill(db,resource,resource==='notifications'?120:20,ids.org,resource==='notifications'?undefined:ids.employee);
  let result=await runAutomationWorker(storeFor(db),{enabled:true});assert.equal(result.capacityDeferred,1);assert.equal(await count(db,'public.notifications'),0);
  await owner(db);let step=(await db.query('select * from public.automation_execution_steps')).rows[0];assert.equal(step.attempts,0);assert.equal(step.status,'pending');assert.equal((await db.query('select action_count from private.automation_chains')).rows[0].action_count,0);
  await recover(db);result=await runAutomationWorker(storeFor(db),{enabled:true});assert.equal(result.acknowledged,1);assert.equal(await count(db,'public.notifications'),1);assert.equal(await count(db,'private.notification_email_outbox'),1);
 });
 await scenario('natural ticket notifications defer Automation mutation, ordinary user mutation succeeds',async()=>{
  await createRule(db,{actions:[action('set_status',{status:'resolved'})]});await activate(db);const target=await ticket(db);await fill(db,'notifications',120);
  assert.equal((await runAutomationWorker(storeFor(db),{enabled:true})).capacityDeferred,1);
  await owner(db);assert.equal((await db.query('select status from public.tickets where id=$1',[target.id])).rows[0].status,'new');
  await identity(db);await db.query("update public.tickets set status='resolved' where id=$1",[target.id]);
  assert.equal((await db.query('select status from public.tickets where id=$1',[target.id])).rows[0].status,'resolved');
 });
 await scenario('noisy tenant with hundreds of durable events cannot starve smaller tenant',async()=>{
  await createRule(db,{actions:[action('add_internal_note',{body:'Fair workload'})]});await createRule(db,{tenant:ids.otherOrg,actions:[action('add_internal_note',{body:'Small workload'})]});await activate(db);
  await identity(db);await db.query("insert into public.tickets(organization_id,requester_id,title,description) select $1,$2,'Bulk test '||n,'Synthetic' from generate_series(1,240) n",[ids.org,ids.employee]);
  const small=await ticket(db,ids.otherOrg);await service(db);
  const result=await runAutomationWorker(storeFor(db),{enabled:true});assert.equal(result.acknowledged,5);
  await owner(db);assert.equal((await db.query('select count(*)::int n from public.automation_executions where entity_id=$1',[small.id])).rows[0].n,1);
  assert.ok((await db.query("select count(*)::int n from private.domain_event_deliveries where status='pending'")).rows[0].n>=236);
  for(let i=0;i<60;i++){await recover(db);await runAutomationWorker(storeFor(db),{enabled:true});}
  assert.equal((await count(db,'public.automation_executions')),241);
 });
 await scenario('retry lane bounded; fresh work still admitted; exhaustion unchanged',async()=>{
  await createRule(db);await activate(db);for(let i=0;i<10;i++)await ticket(db);
  await owner(db);await db.exec("update private.domain_event_deliveries set attempts=1 where id in (select id from private.domain_event_deliveries order by id limit 8)");await fill(db,'retryClaims',5);
  await runAutomationWorker(storeFor(db),{enabled:true});await owner(db);
  assert.ok((await db.query("select count(*)::int n from private.domain_event_deliveries where status='acknowledged'")).rows[0].n>0);
  assert.ok((await db.query("select count(*)::int n from private.domain_event_deliveries where capacity_reason='worker_deferred_capacity' and attempts=1")).rows[0].n>0);
  await db.exec("update private.domain_event_deliveries set attempts=8,available_at=clock_timestamp() where status='pending'");await service(db);await runAutomationWorker(storeFor(db),{enabled:true});await owner(db);assert.ok((await db.query("select count(*)::int n from private.domain_event_deliveries where error_code='retry_exhausted'")).rows[0].n>0);
 });
 await scenario('execution-heavy workload reaches exactly 120, preserves overflow and drains later',async()=>{
  for(let i=0;i<10;i++)await createRule(db,{conditions:group(condition('priority','equals','critical'))});await activate(db);for(let i=0;i<13;i++)await ticket(db);await service(db);
  for(let i=0;i<3;i++)await runAutomationWorker(storeFor(db),{enabled:true});
  assert.equal(await count(db,'public.automation_executions'),120);await owner(db);assert.equal((await db.query("select count(*)::int n from private.domain_event_deliveries where capacity_reason='execution_deferred_capacity' and attempts=0")).rows[0].n,1);
  await recover(db);await runAutomationWorker(storeFor(db),{enabled:true});assert.equal(await count(db,'public.automation_executions'),130);
 });
 await scenario('notification-heavy workload preserves overflow and isolates the second tenant',async()=>{
  const notifications=Array.from({length:5},(_,i)=>action('send_notification',{recipient:'requester',template:'ticket_update'},i));
  await createRule(db,{actions:notifications});await createRule(db,{tenant:ids.otherOrg,actions:notifications});await activate(db);for(let i=0;i<5;i++)await ticket(db);await ticket(db,ids.otherOrg);await service(db);
  for(let i=0;i<2;i++)await runAutomationWorker(storeFor(db),{enabled:true});
  await owner(db);assert.equal((await db.query('select count(*)::int n from public.notifications where organization_id=$1',[ids.org])).rows[0].n,20);assert.equal((await db.query('select count(*)::int n from public.notifications where organization_id=$1',[ids.otherOrg])).rows[0].n,5);
  assert.equal((await db.query("select count(*)::int n from private.domain_event_deliveries where capacity_reason='notification_deferred_capacity' and attempts=0")).rows[0].n,1);
  await recover(db);await runAutomationWorker(storeFor(db),{enabled:true});assert.equal(await count(db,'public.notifications'),30);
 });
 await scenario('actual 100-ticket bulk update commits while execution capacity is full; backlog drains',async()=>{
  await createRule(db,{trigger:'ticket.priority_changed',actions:[action('add_internal_note',{body:'Bulk notification note'})]});await activate(db);
  await identity(db);const targets=(await db.query("insert into public.tickets(organization_id,requester_id,title,description) select $1,$2,'Bulk update '||n,'Synthetic' from generate_series(1,100) n returning id",[ids.org,ids.employee])).rows.map(r=>r.id);
  await fill(db,'executions',120);await identity(db);
  const changed=await db.query("update public.tickets set priority='high' where organization_id=$1 and id=any($2::uuid[]) returning id",[ids.org,targets]);assert.equal(changed.rows.length,100);
  await owner(db);assert.equal((await db.query("select count(*)::int n from private.domain_events where event_type='ticket.priority_changed'")).rows[0].n,100);
  await service(db);await runAutomationWorker(storeFor(db),{enabled:true});
  for(let i=0;i<55;i++){await recover(db);await runAutomationWorker(storeFor(db),{enabled:true});}
  assert.equal(await count(db,'public.ticket_messages'),100);
 });
 await scenario('temporal tenant rotation preserves 5 × 100, cursor recovery and lag',async()=>{
  for(const tenant of [ids.org,ids.org,ids.org,ids.org,ids.org,ids.org,ids.otherOrg]){
   const r=await createRule(db,{tenant,enabled:false});await identity(db,'authenticated',tenant===ids.org?ids.admin:ids.otherAdmin);
   const d=definition({trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:1}},conditions:group(),actions:[action('add_internal_note',{body:'Temporal'})]});
   await db.query('select public.update_automation_rule($1,$2,$3,$4)',[tenant,r.id,r.version,d]);await db.query('select public.set_automation_rule_enabled($1,$2,2,true)',[tenant,r.id]);
  }
  await activate(db);await owner(db);await db.exec("update private.automation_processing_state set activated_at=clock_timestamp()-interval '5 minutes';update public.automation_rules set enabled_at=clock_timestamp()-interval '5 minutes';");
  // Version creation is still authoritative: thresholds are just after now.
  for(const tenant of [ids.org,ids.otherOrg]){await identity(db,'authenticated',tenant===ids.org?ids.admin:ids.otherAdmin);await owner(db);await db.query("insert into public.tickets(organization_id,requester_id,title,description,created_at) select $1,$2,'Temporal backlog '||n,'Synthetic',clock_timestamp()-interval '60 seconds' from generate_series(1,105) n",[tenant,tenant===ids.org?ids.employee:ids.otherAdmin]);}
  await service(db);await db.exec('savepoint discovery_rollback');const first=(await db.query('select public.discover_temporal_automation() r')).rows[0].r;assert.ok(first.examined<=500);assert.ok(first.emitted<=500);await db.exec('rollback to savepoint discovery_rollback;release savepoint discovery_rollback');
  await db.query('select public.discover_temporal_automation()');await owner(db);assert.ok((await db.query('select count(*)::int n from private.automation_temporal_occurrences where organization_id=$1',[ids.otherOrg])).rows[0].n>0);
  await service(db);await db.query('select public.discover_temporal_automation()');await identity(db,'authenticated',ids.otherAdmin);const overview=(await db.query('select public.read_automation_operations($1) r',[ids.otherOrg])).rows[0].r;assert.ok(overview.lag.sampled>0);assert.ok(overview.temporalRules[0].lastScannedAt);
 });
 await scenario('intrinsically oversized notification fanout terminates with a distinct safety outcome',async()=>{
  await owner(db);await db.query("insert into auth.users(id,email) select ('90000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'guard'||n||'@example.invalid' from generate_series(1,121)n");await db.query("insert into public.organization_memberships(organization_id,user_id,role) select $1,id,'technician' from auth.users where id::text like '90000000-%'",[ids.org]);
  await createRule(db,{actions:[action('set_status',{status:'open'})]});await activate(db);await identity(db);await db.query("insert into public.tickets(organization_id,requester_id,title,description,status) values($1,$2,'Reopen test','Synthetic','resolved')",[ids.org,ids.employee]);await service(db);await runAutomationWorker(storeFor(db),{enabled:true});
  await owner(db);assert.equal((await db.query('select error_code from public.automation_executions')).rows[0].error_code,'notification_fanout_limit');assert.equal(await count(db,'public.notifications'),0);
 });
 await scenario('import passes through structural validation and saves disabled at the active ceiling',async()=>{
  const {exportPortablePackage,resolvePortableDraft}=load('src/features/automation/portable.ts');
  const {definition:d}=resolvePortableDraft(exportPortablePackage(definition({conditions:group()}),{}),{});
  for(let i=0;i<100;i++)await createRule(db);
  await identity(db);const imported=(await db.query('select * from public.create_automation_rule($1,$2)',[ids.org,d])).rows[0];assert.equal(imported.enabled,false);
  await safeReject(db,'select public.set_automation_rule_enabled($1,$2,1,true)',[ids.org,imported.id],'FF001');
  assert.throws(()=>exportPortablePackage(byteDefinition(262145),{}));
 });
 await scenario('counter writes and other-tenant Operations denied to every ordinary role',async()=>{
  for(const [role,actor] of [['authenticated',ids.admin],['authenticated',ids.worker],['authenticated',ids.employee],['anon',null],['service_role',null]]){
   await identity(db,role,actor);await safeReject(db,"select private.take_automation_capacity($1,'executions')",[ids.org],'42501');await safeReject(db,"update private.automation_capacity set used=0",[],'42501');
  }
  await identity(db);await safeReject(db,'select public.read_automation_operations($1)',[ids.otherOrg],'42501');
 });
 await scenario('capacity in one organization does not charge or defer another',async()=>{
  await createRule(db);await createRule(db,{tenant:ids.otherOrg});await activate(db);await ticket(db);await ticket(db,ids.otherOrg);await fill(db,'executions',120);
  const result=await runAutomationWorker(storeFor(db),{enabled:true});assert.equal(result.capacityDeferred,1);assert.equal(result.acknowledged,1);
  await identity(db,'authenticated',ids.otherAdmin);const view=(await db.query('select public.read_automation_operations($1) r',[ids.otherOrg])).rows[0].r;assert.equal(view.queue.capacityDeferred,0);
 });
 }finally{await db.close();}
});

test('Stage 12 upgrades legacy excess active rules without disabling or activating anything',async()=>{
 let before;
 const db=await migratedPostgres({beforeMigration:async(db,file)=>{
  if(!file.endsWith('_automation_guardrails.sql'))return;
  await db.exec('begin');await seed(db);for(let i=0;i<101;i++)await createRule(db);await owner(db);before=(await db.query('select to_jsonb(r) r from public.automation_rules r order by id')).rows;await db.exec('commit');
 }});
 try{assert.deepEqual((await db.query('select to_jsonb(r) r from public.automation_rules r order by id')).rows,before);assert.equal((await db.query('select active from private.automation_processing_state')).rows[0].active,false);assert.equal((await db.query('select count(*)::int n from private.automation_tenant_schedule')).rows[0].n,2);}
 finally{await db.close();}
});
