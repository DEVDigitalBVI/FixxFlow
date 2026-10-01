import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
import { definition } from '../../../tests/fixtures/automation.mjs';
const { TemporalControls }=load('src/features/automation/temporal-controls.tsx');
const {presentValidationIssue}=load('src/features/automation/validation-presentation.ts');
test('duration controls preserve canonical minutes, use native keyboard controls and associate errors',()=>{
 const props={trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:30}},invalid:true,onChange:value=>{props.trigger=value;}};
 const h=componentHarness('src/features/automation/temporal-controls.tsx','TemporalControls',props);
 try{
  h.find(n=>n.props.id==='automation-duration-unit').props.onChange({target:{value:'60'}});h.render();
  assert.equal(h.find(n=>n.props.id==='automation-duration').props.value,.5);
  h.find(n=>n.props.id==='automation-duration').props.onChange({target:{value:'24'}});h.render();assert.equal(props.trigger.configuration.durationMinutes,1440);
  const input=h.find(n=>n.props.id==='automation-duration');assert.equal(input.props['aria-invalid'],true);assert.match(input.props['aria-describedby'],/automation-trigger-error/);
  assert.equal(h.find(n=>n.props.htmlFor==='automation-duration').type,'label');assert.equal(h.find(n=>n.props.id==='automation-duration-unit').type,'select');
  h.find(n=>n.props.id==='automation-duration').props.onChange({target:{value:''}});assert.equal(props.trigger.configuration.durationMinutes,'');
 }finally{h.close();}
});
test('SLA requirement is contextual; breach needs no duration; guidance states creation age and unknown episodes',()=>{
 const render=trigger=>renderToStaticMarkup(React.createElement(TemporalControls,{trigger,onChange(){}}));
 const breach=render({type:'ticket.sla_breached',configuration:{objective:'response'}});assert.match(breach,/SLA requirement/);assert.doesNotMatch(breach,/id="automation-duration"/);
 assert.match(render({type:'ticket.open_duration_reached',configuration:{durationMinutes:1440}}),/Reopening does not reset/);
 assert.match(render({type:'ticket.unassigned_duration_reached',configuration:{durationMinutes:30}}),/unknown start time/);
 const issue=presentValidationIssue(definition({trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:0}}}),{path:'trigger',code:'invalid_trigger'});assert.match(issue.message,/1 minute to 365 days/);assert.equal(issue.target,'automation-duration');
});
test('builder trigger selection initializes only supported configuration and retains unrelated draft values',()=>{
 const h=componentHarness('src/features/automation/builder.tsx','AutomationBuilder',{draft:definition({name:'Retain my draft'})},{'server-only':{},'next/navigation':{useRouter:()=>({})},'@/app/app/administration/automations/actions':{}});
 try{
  h.find(n=>n.props.id==='automation-trigger').props.onChange({target:{value:'ticket.sla_approaching'}});h.render();
  const controls=h.find(n=>typeof n.type==='function'&&n.type.name==='TemporalControls');assert.deepEqual(controls.props.trigger.configuration,{durationMinutes:30,objective:'resolution'});
  assert.equal(h.find(n=>n.props.id==='automation-name').props.value,'Retain my draft');
 }finally{h.close();}
});
test('scheduler cron authenticates first, remains OFF by default and logs only bounded result data',async()=>{
 const previous={secret:process.env.CRON_SECRET,flag:process.env.AUTOMATION_PROCESSING_ENABLED};let calls=0;
 const {GET}=load('src/app/api/cron/automation-scheduler/route.ts',{'@/features/automation/operations-telemetry':{observeAutomationRun:async(_client,_kind,work)=>work()},
    '@/lib/supabase/admin':{createAdminClient(){calls++;return{};}},'@/features/automation/scheduler':{discoverTemporalAutomation:async()=>({examined:1,emitted:1,duplicates:0})}});
 try{
  process.env.CRON_SECRET='isolated-test-secret';delete process.env.AUTOMATION_PROCESSING_ENABLED;
  assert.equal((await GET(new Request('http://localhost/api/cron/automation-scheduler'))).status,401);assert.equal(calls,0);
  const req=()=>new Request('http://localhost/api/cron/automation-scheduler',{headers:{authorization:'Bearer isolated-test-secret'}});
  assert.deepEqual(await(await GET(req())).json(),{disabled:true});assert.equal(calls,0);
  process.env.AUTOMATION_PROCESSING_ENABLED='true';assert.deepEqual(await(await GET(req())).json(),{examined:1,emitted:1,duplicates:0});assert.equal(calls,1);
 }finally{for(const[key,value]of[['CRON_SECRET',previous.secret],['AUTOMATION_PROCESSING_ENABLED',previous.flag]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
