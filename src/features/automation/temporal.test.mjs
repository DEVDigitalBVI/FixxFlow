import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../../../tests/helpers/load-module.mjs';
import { definition, rule, event, group, action, registry, validateDefinition, planAutomation, uuid } from '../../../tests/fixtures/automation.mjs';
const { evaluateTemporal, temporalTypes } = load('src/features/automation/domains/tickets/temporal.ts');
const { evaluateDryRun } = load('src/features/automation/dry-run.ts');
const { ticketDryRunEvent } = load('src/features/automation/domains/tickets/dry-run-context.ts');
const { automationSummary } = load('src/features/automation/summary.ts');
const start='2026-10-01T00:00:00.000Z', now='2026-10-01T00:30:00.000Z';
const trigger=(type=temporalTypes[0],config={durationMinutes:30})=>({type,configuration:config});
const snapshot={...event().after,created_at:start,unassigned_since:start,unassigned_episode_id:uuid(30),waiting_on_user_since:start,waiting_on_user_episode_id:uuid(31),first_response_at:null,resolved_at:null,closed_at:null,response_sla_due_at:now,resolution_sla_due_at:now};
test('canonical durations validate minutes, hours and days and reject malformed/unbounded inputs',()=>{
 for(const type of temporalTypes) for(const minutes of [1,15,30,120,1440,4320,10080,525600,0,-1,525601,1.5,'30',null,{},Infinity]){
  const config={...(type==='ticket.sla_breached'?{}:{durationMinutes:minutes}),...(type.startsWith('ticket.sla_')?{objective:'resolution'}:{})};
  const d=definition({trigger:trigger(type,config)});
  assert.equal(validateDefinition(d,registry).valid,type==='ticket.sla_breached'||typeof minutes==='number'&&Number.isInteger(minutes)&&minutes>=1&&minutes<=525600,JSON.stringify(config));
 }
 for(const config of [{},{durationMinutes:30,code:'eval()'},{durationMinutes:30,objective:'invalid'},{durationMinutes:{value:30,unit:'minutes'}}]) assert.equal(validateDefinition(definition({trigger:trigger(temporalTypes[0],config)}),registry).valid,false);
});
test('elapsed thresholds are false below, true exactly at and above the boundary',()=>{
 for(const type of temporalTypes.slice(0,3)){
  const s={...snapshot,status:type===temporalTypes[1]?'waiting_on_user':'open'};
  assert.equal(evaluateTemporal(trigger(type),s,'2026-10-01T00:29:59.999Z').met,false);
  assert.equal(evaluateTemporal(trigger(type),s,now).met,true);
  assert.equal(evaluateTemporal(trigger(type),s,'2026-10-01T00:31:00Z').met,true);
  for(const status of ['resolved','closed'])assert.equal(evaluateTemporal(trigger(type),{...s,status},now).met,false);
 }
 assert.equal(evaluateTemporal(trigger(),{...snapshot,assigned_technician_id:uuid(50)},now).met,false);
 assert.equal(evaluateTemporal(trigger(temporalTypes[1]),snapshot,now).met,false);
 assert.equal(evaluateTemporal(trigger(),{...snapshot,unassigned_since:null,unassigned_episode_id:null},now).known,false);
 assert.equal(evaluateTemporal(trigger(),{...snapshot,team_id:uuid(60)},now).met,true);
});
test('SLA uses stored deadline, excludes satisfied goals, and separates approaching from breached',()=>{
 for(const objective of ['response','resolution']){
  const approaching=trigger('ticket.sla_approaching',{objective,durationMinutes:15});
  const breached=trigger('ticket.sla_breached',{objective});
  assert.equal(evaluateTemporal(approaching,snapshot,'2026-10-01T00:14:59.999Z').met,false);
  assert.equal(evaluateTemporal(approaching,snapshot,'2026-10-01T00:15:00Z').met,true);
  assert.equal(evaluateTemporal(approaching,snapshot,now).met,false);
  assert.equal(evaluateTemporal(breached,snapshot,'2026-10-01T00:29:59.999Z').met,false);
  assert.equal(evaluateTemporal(breached,snapshot,now).met,true);
  const satisfied={...snapshot,[objective==='response'?'first_response_at':'resolved_at']:start};
  assert.equal(evaluateTemporal(breached,satisfied,now).met,false);
  assert.equal(evaluateTemporal(approaching,satisfied,'2026-10-01T00:15:00Z').met,false);
  const next={...snapshot,[`${objective}_sla_due_at`]:'2026-10-01T01:00:00Z'};
  assert.notEqual(evaluateTemporal(breached,next,now).episode,evaluateTemporal(breached,snapshot,now).episode);
 }
});
test('temporal dry run is the real planner, including false threshold and configuration mismatch',()=>{
 for(const type of temporalTypes){
  const tr=trigger(type,{...(type==='ticket.sla_breached'?{}:{durationMinutes:30}),...(type.startsWith('ticket.sla_')?{objective:'resolution'}:{})});
  const d=definition({trigger:tr,conditions:group(),actions:[action()]});
  for(const evaluatedAt of ['2026-09-30T23:59:00Z',now]){
   const context={organizationId:event().organizationId,ticketId:event().entityId,ticketNumber:1,revision:1,snapshot:{...snapshot,status:'waiting_on_user'},event:null,definition:d,ruleId:null,ruleVersion:null,storedEnabled:null,storedArchived:false,conditionsReferencesValid:true,actionReferences:[{actionId:'action-0',valid:true}],evaluatedAt};
   const source={kind:'current_ticket'}, e=ticketDryRunEvent(context,source), result=evaluateDryRun(context,e,source,registry);
   assert.equal(result.plannerStatus,planAutomation(rule({definition:d}),e,registry,e.organizationId).status);
   assert.equal(result.sideEffectsPerformed,false);assert.equal(result.notice,'No changes were made.');assert.equal(result.temporal.evaluatedAt,evaluatedAt);
   assert.equal(planAutomation(rule({definition:d}),{...e,after:{...e.after,temporal:{configuration:{}}}},registry,e.organizationId).status,'incompatible_trigger');
  }
 }
});
test('summaries use readable durations, SLA objectives and creation age',()=>{
 assert.match(automationSummary(definition({trigger:trigger(temporalTypes[1],{durationMinutes:4320})})),/waiting on the requester for 3 days/);
 assert.match(automationSummary(definition({trigger:trigger(temporalTypes[2],{durationMinutes:1440})})),/24|1 day since creation/);
 assert.match(automationSummary(definition({trigger:trigger('ticket.sla_approaching',{durationMinutes:30,objective:'resolution'})})),/resolution SLA is due within 30 minutes/);
});
test('microsecond precision never rounds a threshold forward in the planner',()=>{
 const s={...snapshot,unassigned_since:'2026-10-01T00:00:00.000999Z'};
 assert.equal(evaluateTemporal(trigger(),s,'2026-10-01T00:30:00.000998Z').met,false);
 assert.equal(evaluateTemporal(trigger(),s,'2026-10-01T00:30:00.000999Z').met,true);
 assert.equal(evaluateTemporal(trigger(),s,'2026-10-01T00:30:00.001Z').met,true);
 assert.equal(evaluateTemporal(trigger(),s,now).thresholdAt,'2026-10-01T00:30:00.000999Z');
});
