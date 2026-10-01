import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedPostgres } from '../../../tests/helpers/postgres.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { ids, seed, owner, identity, service, ticket, activate, tick, storeFor, runAutomationWorker } from '../../../tests/helpers/automation-worker.mjs';
import { definition, action, group, condition, uuid } from '../../../tests/fixtures/automation.mjs';
const episodeMigration='20261001160233_automation_temporal_episodes.sql';
const { persistenceRegistry }=load('src/features/automation/persistence-contract.ts');
const { evaluateDryRun }=load('src/features/automation/dry-run.ts');
const { ticketDryRunEvent }=load('src/features/automation/domains/tickets/dry-run-context.ts');
const temporalDefinition=(type='ticket.unassigned_duration_reached',configuration={durationMinutes:1},conditions=group())=>definition({trigger:{type,configuration},conditions,actions:[action('add_internal_note',{body:'Temporal verification successful.'})]});
async function temporalRule(db,d=temporalDefinition(),tenant=ids.org,enabled=true){
 await identity(db,'authenticated',tenant===ids.org?ids.admin:ids.otherAdmin);
 let r=(await db.query('select * from public.create_automation_rule($1,$2)',[tenant,d])).rows[0];
 if(enabled)r=(await db.query('select * from public.set_automation_rule_enabled($1,$2,$3,true)',[tenant,r.id,r.version])).rows[0];
 await tick();return r;
}
async function discover(db,limit=100){await service(db);return (await db.query('select public.discover_temporal_automation(5,$1) result',[limit])).rows[0].result;}
async function readTicket(db,id){await owner(db);return (await db.query('select * from public.tickets where id=$1',[id])).rows[0];}
async function edit(db,id,sql,args=[]){await identity(db);return (await db.query(`update public.tickets set ${sql} where id=$1 returning *`,[id,...args])).rows[0];}
// Test-only clock fixture, never a runtime RPC. The production trigger is disabled
// only within the disposable rolled-back transaction to avoid minute-long sleeps.
async function clockFixture(db,id,column,offset='60 seconds'){
 assert.ok(['unassigned_since','waiting_on_user_since','created_at','response_sla_due_at','resolution_sla_due_at'].includes(column));
 await owner(db);await db.exec('alter table public.tickets disable trigger tickets_y_temporal_episodes; alter table public.tickets disable trigger tickets_sla_prepare');
 await db.query(`update public.tickets set ${column}=clock_timestamp()-$2::interval where id=$1`,[id,offset]);
 await db.exec('alter table public.tickets enable trigger tickets_y_temporal_episodes; alter table public.tickets enable trigger tickets_sla_prepare');await tick();
}
async function error(db,sql,args=[],code='42501'){
 await db.exec('savepoint expected_error');await assert.rejects(db.query(sql,args),e=>!code||e.code===code);await db.exec('rollback to savepoint expected_error; release savepoint expected_error');
}
async function temporalEvents(db){await owner(db);return (await db.query('select * from private.domain_events where temporal_occurrence_id is not null order by occurred_at,id')).rows;}

test('Stage 9 clean replay: episodes, scheduler, trusted pipeline, isolation and dry run',async t=>{
 const db=await migratedPostgres();
 const scenario=async(name,run)=>t.test(name,async()=>{await db.exec('begin');await seed(db);try{await run();}finally{await db.exec('rollback');}});
 try{
  await scenario('new episodes reflect final routing; unrelated edits/team preserve identity; transition cycles reset identity',async()=>{
   const a=await ticket(db);assert.ok(a.unassigned_episode_id);assert.ok(a.unassigned_since);assert.equal(a.waiting_on_user_since,null);
   const b=await edit(db,a.id,"title='A different title',team_id='40000000-0000-0000-0000-000000000401'");assert.equal(b.unassigned_episode_id,a.unassigned_episode_id);assert.deepEqual(b.unassigned_since,a.unassigned_since);
   const c=await edit(db,a.id,'assigned_technician_id=$2',[ids.worker]);assert.equal(c.unassigned_since,null);assert.equal(c.unassigned_episode_id,null);
   const d=await edit(db,a.id,'assigned_technician_id=null');assert.notEqual(d.unassigned_episode_id,a.unassigned_episode_id);
   await owner(db);
   // Existing routing only chooses teams. Simulate a future earlier DB routing
   // trigger that assigns a technician to prove episode ordering is post-routing.
   await db.exec(`create function pg_temp.test_assign() returns trigger language plpgsql as $$ begin new.assigned_technician_id:='${ids.worker}';return new;end $$;create trigger tickets_route_test before insert on public.tickets for each row execute function pg_temp.test_assign()`);
   const assigned=await ticket(db);assert.equal(assigned.assigned_technician_id,ids.worker);assert.equal(assigned.unassigned_episode_id,null);
   await owner(db);await db.exec('drop trigger tickets_route_test on public.tickets');
   await identity(db);const routed=(await db.query("insert into public.tickets(organization_id,requester_id,title,description,category_id,status) values($1,$2,'Routed waiting ticket','Private','50000000-0000-0000-0000-000000000401','waiting_on_user') returning *",[ids.org,ids.employee])).rows[0];
   assert.ok(routed.team_id);assert.ok(routed.unassigned_episode_id);assert.ok(routed.waiting_on_user_episode_id);
   assert.equal(routed.revision,1);
  });
  await scenario('waiting episodes change only on entry/exit, cannot be forged, and carry consistent revisions',async()=>{
   const a=await ticket(db);const waiting=await edit(db,a.id,"status='waiting_on_user'");assert.ok(waiting.waiting_on_user_episode_id);assert.equal(waiting.revision,a.revision+1);
   const other=await edit(db,a.id,"priority='high'");assert.equal(other.waiting_on_user_episode_id,waiting.waiting_on_user_episode_id);assert.deepEqual(other.waiting_on_user_since,waiting.waiting_on_user_since);
   const left=await edit(db,a.id,"status='in_progress'");assert.equal(left.waiting_on_user_since,null);
   const again=await edit(db,a.id,"status='waiting_on_user'");assert.notEqual(again.waiting_on_user_episode_id,waiting.waiting_on_user_episode_id);
   await error(db,'update public.tickets set unassigned_since=now() where id=$1',[a.id]);
   await error(db,'update public.tickets set waiting_on_user_episode_id=$2 where id=$1',[a.id,uuid(8)]);
   await owner(db);const e=(await db.query("select after_snapshot,entity_version from private.domain_events where entity_id=$1 and event_type='ticket.status_changed' order by entity_version desc limit 1",[a.id])).rows[0];
   assert.equal(e.after_snapshot.waiting_on_user_episode_id,again.waiting_on_user_episode_id);assert.equal(Number(e.entity_version),again.revision);
  });
  await scenario('OFF and disabled rules generate no temporal events; service-only access enforced',async()=>{
   await temporalRule(db);const a=await ticket(db);await clockFixture(db,a.id,'unassigned_since');assert.equal((await discover(db)).disabled,true);
   await activate(db);const disabled=await temporalRule(db,temporalDefinition(),ids.otherOrg,false);assert.equal(disabled.enabled,false);
   const b=await ticket(db,ids.otherOrg);await clockFixture(db,b.id,'unassigned_since');assert.equal((await discover(db)).emitted,0);
   await identity(db);await error(db,'select public.discover_temporal_automation()');
   for(const who of [ids.admin,ids.worker,ids.employee]){await identity(db,'authenticated',who);for(const table of ['automation_temporal_occurrences','automation_temporal_cursors'])await error(db,`select * from private.${table}`);}
   await service(db);await error(db,'insert into private.automation_temporal_cursors(organization_id,rule_id,rule_version,generation) values($1,$2,1,1)',[ids.org,uuid(999)]);await error(db,'select public.discover_temporal_automation(6,100)',[],'22023');
   assert.equal((await temporalEvents(db)).length,0);
  });
  await scenario('unassigned threshold emits once; worker uses existing trusted action and receipt; new episode can emit',async()=>{
   await activate(db);const r=await temporalRule(db);const a=await ticket(db);assert.equal((await discover(db)).emitted,0);
   await clockFixture(db,a.id,'unassigned_since');assert.equal((await discover(db)).emitted,1);assert.equal((await discover(db)).emitted,0);
   const [e]=await temporalEvents(db);assert.equal(e.organization_id,ids.org);assert.equal(e.after_snapshot.temporal.ruleId,r.id);assert.equal(e.actor_type,'system');assert.equal(e.causation_id,null);assert.equal(e.root_event_id,e.id);
   await service(db);await runAutomationWorker(storeFor(db),{enabled:true,log(){}});
   await owner(db);const x=(await db.query('select * from public.automation_executions where event_id=$1',[e.id])).rows[0];assert.equal(x.status,'succeeded');assert.equal(Number(x.rule_version),r.version);assert.equal(x.correlation_id,e.correlation_id);
   assert.equal((await db.query('select count(*)::int n from public.ticket_messages where automation_execution_id=$1',[x.id])).rows[0].n,1);
   assert.equal((await db.query('select status from public.automation_execution_steps where execution_id=$1',[x.id])).rows[0].status,'succeeded');
   await edit(db,a.id,'assigned_technician_id=$2',[ids.worker]);await edit(db,a.id,'assigned_technician_id=null');await clockFixture(db,a.id,'unassigned_since');assert.equal((await discover(db)).emitted,1);
  });
  await scenario('waiting state exit prevents firing; re-entry creates a new threshold occurrence',async()=>{
   await activate(db);await temporalRule(db,temporalDefinition('ticket.waiting_on_user_duration_reached'));const a=await ticket(db);await edit(db,a.id,"status='waiting_on_user'");await clockFixture(db,a.id,'waiting_on_user_since');assert.equal((await discover(db)).emitted,1);
   await edit(db,a.id,"status='in_progress'");assert.equal((await discover(db)).emitted,0);
   await edit(db,a.id,"status='waiting_on_user'");await clockFixture(db,a.id,'waiting_on_user_since');assert.equal((await discover(db)).emitted,1);
   const events=await temporalEvents(db);assert.notEqual(events[0].after_snapshot.temporal.episode,events[1].after_snapshot.temporal.episode);
  });
  await scenario('backlog, shortened thresholds and processing reactivation do not replay old crossings',async()=>{
   await activate(db);const r=await temporalRule(db,temporalDefinition('ticket.open_duration_reached',{durationMinutes:2}));const a=await ticket(db);await clockFixture(db,a.id,'created_at','90 seconds');
   await identity(db);await db.query('select * from public.update_automation_rule($1,$2,$3,$4)',[ids.org,r.id,r.version,temporalDefinition('ticket.open_duration_reached',{durationMinutes:1})]);
   assert.equal((await discover(db)).emitted,0);
   await activate(db,false);await clockFixture(db,a.id,'created_at');await activate(db,true);assert.equal((await discover(db)).emitted,0);
  });
  await scenario('Open For uses creation age after reopen, but excludes terminal tickets',async()=>{
   await activate(db);await temporalRule(db,temporalDefinition('ticket.open_duration_reached'));const a=await ticket(db);await clockFixture(db,a.id,'created_at');const age=(await readTicket(db,a.id)).created_at;
   await edit(db,a.id,"status='resolved'");assert.equal((await discover(db)).emitted,0);await edit(db,a.id,"status='closed'");assert.equal((await discover(db)).emitted,0);
   await edit(db,a.id,"status='open'");assert.deepEqual((await readTicket(db,a.id)).created_at,age);assert.equal((await discover(db)).emitted,1);assert.equal((await discover(db)).emitted,0);
  });
  await scenario('bounded pages and repeated/overlapping callers preserve one occurrence; rollback safely rediscovers',async()=>{
   await activate(db);await temporalRule(db);for(let i=0;i<3;i++){const a=await ticket(db);await clockFixture(db,a.id,'unassigned_since');}
   await owner(db);await db.exec('savepoint crash');assert.equal((await discover(db,2)).emitted,2);await owner(db);await db.exec('rollback to savepoint crash');
   assert.equal((await discover(db,2)).emitted,2);assert.equal((await discover(db,2)).emitted,1);
   const results=await Promise.all([discover(db,2),discover(db,2)]);assert.equal(results.reduce((n,r)=>n+r.emitted,0),0);assert.equal((await temporalEvents(db)).length,3);
   // PGlite serializes these calls; independent native sessions are a separate gate.
  });
  await scenario('multiple rules/thresholds at the same ticket revision remain separately scoped, including cross-tenant rules',async()=>{
   await activate(db);await temporalRule(db);await temporalRule(db);await temporalRule(db,temporalDefinition(),ids.otherOrg);
   const a=await ticket(db);await clockFixture(db,a.id,'unassigned_since');assert.equal((await discover(db)).emitted,2);
   const events=await temporalEvents(db);assert.equal(events[0].entity_version,events[1].entity_version);assert.notEqual(events[0].temporal_occurrence_id,events[1].temporal_occurrence_id);
   await service(db);const claimed=(await db.query('select * from public.claim_automation_events(5,120)')).rows;assert.equal(claimed.length,2);
   const otherRule=(await temporalEvents(db))[1].after_snapshot.temporal;
   await service(db);const one=claimed.find(c=>c.event.after.temporal.ruleId!==otherRule.ruleId);
   await error(db,'select public.begin_automation_execution($1,$2,$3,$4)',[one.delivery_id,one.lease_token,otherRule.ruleId,otherRule.ruleVersion],'55000');
  });
  await scenario('nonmatching conditions skip actions and changes after capture retain stale revision protection',async()=>{
   await activate(db);await temporalRule(db,temporalDefinition('ticket.unassigned_duration_reached',{durationMinutes:1},group(condition('priority','equals','critical'))));
   const a=await ticket(db);await clockFixture(db,a.id,'unassigned_since');await discover(db);await service(db);await runAutomationWorker(storeFor(db),{enabled:true,log(){}});await owner(db);
   assert.equal((await db.query('select status from public.automation_executions')).rows[0].status,'skipped');assert.equal((await db.query('select count(*)::int n from public.ticket_messages')).rows[0].n,0);
   await temporalRule(db);await edit(db,a.id,'assigned_technician_id=$2',[ids.worker]);await edit(db,a.id,'assigned_technician_id=null');await clockFixture(db,a.id,'unassigned_since');await discover(db);
   await edit(db,a.id,"priority='high'");await service(db);await runAutomationWorker(storeFor(db),{enabled:true,log(){}});await owner(db);
   assert.ok((await db.query("select error_code from public.automation_executions where error_code='stale_entity'")).rows.length);assert.equal((await db.query('select count(*)::int n from public.ticket_messages')).rows[0].n,0);
  });
  await scenario('SLA approaching/breached use current stored deadlines, exclude satisfaction, and deduplicate recalculations',async()=>{
   await activate(db);
   for(const objective of ['response','resolution']){
    const column=objective+'_sla_due_at';
    await temporalRule(db,temporalDefinition('ticket.sla_approaching',{durationMinutes:1,objective}));
    await temporalRule(db,temporalDefinition('ticket.sla_breached',{objective}));
    const a=await ticket(db);assert.equal((await discover(db)).emitted,0);
    await clockFixture(db,a.id,column,'-60 seconds');assert.equal((await discover(db)).emitted,1);assert.equal((await discover(db)).emitted,0);
    await clockFixture(db,a.id,column,'0 seconds');assert.equal((await discover(db)).emitted,1);assert.equal((await discover(db)).emitted,0);
    await clockFixture(db,a.id,column,'-60 seconds');assert.equal((await discover(db)).emitted,1,'a different authoritative deadline is a new occurrence');
    await owner(db);await db.query(`update public.tickets set ${objective==='response'?'first_response_at':'resolved_at'}=clock_timestamp() where id=$1`,[a.id]);
    await clockFixture(db,a.id,column,'0 seconds');assert.equal((await discover(db)).emitted,0);
   }
  });
  await scenario('priority recalculation preserves authoritative SLA policy; SQL and pure boundary evaluation agree',async()=>{
   const a=await ticket(db);const high=await edit(db,a.id,"priority='high'");assert.notDeepEqual(high.resolution_sla_due_at,a.resolution_sla_due_at);
   await owner(db);assert.equal((await db.query('select resolution_sla_due_at=private.ticket_sla_deadline(created_at,priority,false) correct from public.tickets where id=$1',[a.id])).rows[0].correct,true);
   const {evaluateTemporal}=load('src/features/automation/domains/tickets/temporal.ts');
   for(const d of [temporalDefinition(),temporalDefinition('ticket.open_duration_reached'),temporalDefinition('ticket.sla_approaching',{durationMinutes:30,objective:'response'}),temporalDefinition('ticket.sla_breached',{objective:'resolution'})]){
    const row=(await db.query('select private.ticket_temporal_context(t,$2) context,private.ticket_event_snapshot(t) snapshot from public.tickets t where id=$1',[a.id,d])).rows[0];
    const threshold=new Date(row.context.thresholdAt);
    assert.equal(evaluateTemporal(d.trigger,row.snapshot,threshold.toISOString()).met,true);
    assert.equal(evaluateTemporal(d.trigger,row.snapshot,new Date(+threshold-1).toISOString()).met,false);
   }
  });
  await scenario('temporal current-context dry run is read-only across all data and matches planner',async()=>{
   const a=await ticket(db);await clockFixture(db,a.id,'unassigned_since');await owner(db);
   const tables=['public.tickets','public.ticket_messages','public.ticket_activity','public.notifications','private.notification_email_outbox','private.domain_events','private.domain_event_deliveries','public.automation_executions','public.automation_execution_steps','public.audit_events','private.automation_temporal_occurrences','private.automation_temporal_cursors'];
   const snapshot=async()=>{await owner(db);const result={};for(const table of tables)result[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') data from ${table} t`)).rows[0].data;return result;};
   const before=await snapshot();await identity(db);
   const c=(await db.query('select public.read_automation_dry_run($1,$2,null,null,null,$3) result',[ids.org,a.id,temporalDefinition()])).rows[0].result;
   const source={kind:'current_ticket'}, result=evaluateDryRun(c,ticketDryRunEvent(c,source),source,persistenceRegistry);
   assert.equal(result.temporal.met,true);assert.equal(result.wouldProceed,true);assert.equal(result.sideEffectsPerformed,false);assert.deepEqual(await snapshot(),before);
  });
 }finally{await db.close();}
});

test('upgrade leaves existing unknown episodes and chronology untouched until genuine state transitions',async()=>{
 let original;
 const db=await migratedPostgres({beforeMigration:async(db,name)=>{if(name!==episodeMigration)return;await db.exec('begin');await seed(db);const a=await ticket(db);original=await edit(db,a.id,"status='waiting_on_user'");await owner(db);await db.exec('commit');}});
 try{
  await db.exec('begin');const a=await readTicket(db,original.id);assert.equal(a.unassigned_episode_id,null);assert.equal(a.waiting_on_user_episode_id,null);assert.deepEqual(a.updated_at,original.updated_at);assert.equal(a.revision,original.revision);
  const b=await edit(db,a.id,"priority='high'");assert.equal(b.unassigned_since,null);assert.equal(b.waiting_on_user_since,null);
  await edit(db,a.id,"assigned_technician_id=$2,status='in_progress'",[ids.worker]);const c=await edit(db,a.id,"assigned_technician_id=null,status='waiting_on_user'");assert.ok(c.unassigned_episode_id);assert.ok(c.waiting_on_user_episode_id);
  await db.exec('rollback');
 }finally{await db.close();}
});
