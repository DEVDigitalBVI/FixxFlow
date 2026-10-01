import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {load} from '../../../tests/helpers/load-module.mjs';
import {searchNavigation} from '../../../tests/helpers/search-navigation.mjs';
import {action,definition,rule,uuid,group,condition} from '../../../tests/fixtures/automation.mjs';
const model=load('src/features/automation/ui-model.ts');
const navigation={...searchNavigation,notFound:()=>{throw Error('NOT_FOUND');}};
const link={default:props=>React.createElement('a',props)};
const formMock={ActionForm:({children})=>React.createElement('form',null,children)};
const submitMock={SubmitButton:({children,className})=>React.createElement('button',{className,type:'submit'},children)};
const row={id:uuid(2),name:'Critical Network Routing',enabled:false,version:3,trigger_type:'ticket.created',updated_at:'2026-10-01T10:00:00Z',archived_at:null,run_count:2,last_run:{started_at:'2026-10-01T09:00:00Z',status:'failed',error_code:'retry_exhausted'}};
const baseMocks={'server-only':{},'next/link':link,'next/navigation':navigation,'@/components/ui/action-form':formMock,'@/components/ui/submit-button':submitMock,'@/app/app/administration/automations/actions':{manageAutomation:async()=>({}),saveAutomationDraft:async()=>({}),findAutomationChoices:async()=>({ok:true,value:{rows:[],hasNext:false}}),findAutomationEvents:async()=>({ok:true,value:{rows:[],hasNext:false}}),runAutomationTest:async()=>({})}};
test('list shows status, statistics, human labels and retry exhaustion; filter values persist',async()=>{
  const calls=[];const page=load('src/app/app/administration/automations/page.tsx',{...baseMocks,'@/features/automation/ui-service':{automationList:async(...args)=>{calls.push(args);return{rows:[row],hasNext:true,processingActive:false};}}}).default;
  const html=render(await page({searchParams:Promise.resolve({q:'Network',state:'disabled',trigger:'ticket.created',page:'2'})}));
  for(const text of ['Critical Network Routing','Disabled','Ticket created','Retry exhausted','Run count','History','Edit','Create Automation','Processing off','Next','Previous'])assert.ok(html.includes(text),text);
  assert.deepEqual(calls,[['Network','disabled','ticket.created',2]]);assert.match(html,/responsive-table/);assert.match(html,/role="region"/);assert.match(html,/tabindex="0"/);
});
for(const [filters,message] of [[{},'Let FixxFlow handle repeatable work'],[{q:'missing'},'No matching automations']])test(`list empty state: ${message}`,async()=>{
  const page=load('src/app/app/administration/automations/page.tsx',{...baseMocks,'@/features/automation/ui-service':{automationList:async()=>({rows:[],hasNext:false,processingActive:false})}}).default;
  assert.ok(render(await page({searchParams:Promise.resolve(filters)})).includes(message));
});
test('native confirmation forms require named confirmation for enable and archive; copies remain disabled',()=>{
  const {RuleActions}=load('src/features/automation/rule-actions.tsx',baseMocks);const html=render(React.createElement(RuleActions,{id:row.id,name:row.name,version:3,enabled:false}));
  assert.match(html,/<input(?=[^>]*name="confirmation")(?=[^>]*required="")[^>]*>/);assert.match(html,/Enable “Critical Network Routing”/);assert.match(html,/History|history/);assert.match(html,/Create disabled copy/);assert.match(html,/name="version" value="3"/);
});
test('builder uses semantic vertical sections and exposes only established condition/action contracts',()=>{
  const {AutomationBuilder}=load('src/features/automation/builder.tsx',baseMocks);
  const initial={rule:rule({definition:definition({conditions:group(condition('team_id','is_empty')),actions:[action('set_priority',{priority:'critical'}),action('send_notification',{recipient:'requester',template:'ticket_update'},1)]})}),archivedAt:null};
  const html=render(React.createElement(AutomationBuilder,{initial}));
  for(const text of ['When','If','Then','All conditions must match','Move Up','Move Down','Test Automation','Save changes','Requester','Assigned technician'])assert.ok(html.includes(text));
  assert.doesNotMatch(html,/Notify IT Manager|apply_sla|add_tag|<canvas|>OR</);assert.match(html,/aria-label="Move action 2 up"/);assert.match(html,/aria-live="polite"/);
});
test('condition operators and reorder use registry constraints and contiguous immutable ordering',()=>{
  const original=[action('set_priority',{priority:'high'},0,'a'),action('set_status',{status:'open'},1,'b')];
  assert.deepEqual(model.moveAction(original,'b',-1).map(a=>[a.id,a.position]),[['b',0],['a',1]]);assert.deepEqual(original.map(a=>a.id),['a','b']);
  assert.equal(Object.hasOwn(model.newCondition('x','team_id','is_empty'),'value'),false);assert.deepEqual(model.newCondition('x','priority','in').value,[]);
  assert.equal(model.newDefinition().actions.length,0);
});
test('matching/nonmatching dry-run presentation preserves no-change notice, simulation and history warnings',()=>{
  const {DryRunResultView}=load('src/features/automation/dry-run-panel.tsx',baseMocks);
  const result={context:{ticketNumber:1842,currentRevision:3,evaluatedRevision:1,source:'simulated_transition',differsFromCurrent:true},trigger:{compatible:true,explanation:'Compatible.'},conditions:[{id:'c',label:'Category',operator:'equals',expected:uuid(10),actual:uuid(11),status:'failed'}],actions:[],wouldProceed:false,currentReferencesValid:true};
  const html=render(React.createElement(DryRunResultView,{result,labels:{[uuid(10)]:'Network',[uuid(11)]:'Software'}}));
  for(const text of ['Simulated','ticket has changed','Actual: Software','would not run','Not met','Compatible'])assert.ok(html.includes(text));assert.doesNotMatch(html,new RegExp(uuid(10)));
  const source=fs.readFileSync('src/features/automation/dry-run-panel.tsx','utf8');assert.match(source,/<strong>No changes were made\.<\/strong>/);assert.match(source,/definition:\{kind:'draft',value:definition\}/);
  const match=render(React.createElement(DryRunResultView,{result:{...result,context:{...result.context,differsFromCurrent:false,source:'current_ticket'},wouldProceed:true,conditions:[],actions:[{id:'a',type:'set_priority',configuration:{priority:'critical'},validation:'valid',explanation:'Passes.'}]},labels:{}}));assert.match(match,/Set priority → Critical/);assert.match(match,/matches and its current checks pass/);
});
test('execution detail renders pinned historical version and differentiates retry exhaustion and unexecuted actions',async()=>{
  const execution={id:uuid(8),organization_id:uuid(1),rule_id:row.id,rule_version:1,rule_name:'Historical name',entity_id:uuid(4),trigger_type:'ticket.created',started_at:'2026-10-01T10:00:00Z',duration_ms:1000,status:'partially_completed',error_code:'retry_exhausted',conditions:[],actions_attempted:1};
  const data={execution,steps:[{action_id:'action-0',status:'succeeded',error_code:null},{action_id:'action-1',status:'not_attempted',error_code:null}],definition:definition({conditions:group(),actions:[action('set_priority',{priority:'low'}),action('set_status',{status:'open'},1)]}),labels:{},ticketLabel:'Ticket #1842'};
  const page=load('src/app/app/administration/automations/[ruleId]/history/[executionId]/page.tsx',{...baseMocks,'@/features/automation/ui-service':{automationExecution:async()=>data}}).default;
  const html=render(await page({params:Promise.resolve({ruleId:row.id,executionId:execution.id})}));
  for(const text of ['Historical name','Executed version 1','Retry exhausted','Set priority → Low','Not executed','Remaining actions were not executed'])assert.ok(html.includes(text),text);
});
test('administrator reads deny technicians/end users before opening a client and scope history to tenant and pinned version',async()=>{
  for(const role of ['technician','end_user']){
    const service=load('src/features/automation/ui-service.ts',{'server-only':{},'next/navigation':navigation,'@/lib/auth/viewer':{requireViewer:async()=>({role,status:'active'})},'@/lib/supabase/server':{createClient:()=>{throw Error('UNEXPECTED_CLIENT');}}});
    await assert.rejects(service.automationList('','all','',1),/NOT_FOUND/);await assert.rejects(service.automationExecution(uuid(2),uuid(3)),/NOT_FOUND/);
  }
  const source=fs.readFileSync('src/features/automation/ui-service.ts','utf8');assert.match(source,/eq\('version',execution.rule_version\)/);assert.match(source,/eq\('organization_id',viewer.organizationId\)/);assert.match(source,/range\(\(page-1\)\*50,page\*50\)/);
});
test('save and management actions reuse established services, preserve expected versions and never activate processing',async()=>{
  const calls=[];const response={ok:true,value:{rule:rule()}};
  const services=Object.fromEntries(['createAutomation','updateAutomation','duplicateAutomation','setAutomationEnabled','archiveAutomation'].map(name=>[name,async(...args)=>{calls.push([name,...args]);return response;}]));
  const actions=load('src/app/app/administration/automations/actions.ts',{'server-only':{},'next/cache':{revalidatePath:()=>{}},'@/features/automation/admin-service':services,'@/features/automation/dry-run-service':{testAutomation:async()=>({ok:false,error:{message:'Invalid'}})},'@/features/automation/ui-service':{}});
  await actions.saveAutomationDraft(null,null,definition());await actions.saveAutomationDraft(uuid(2),7,definition());assert.equal(calls[0][0],'createAutomation');assert.deepEqual(calls[1].slice(0,3),['updateAutomation',uuid(2),7]);assert.equal(calls.some(c=>c[0]==='setAutomationEnabled'),false);
  const form=(op,confirmed=true)=>{const f=new FormData();f.set('id',uuid(2));f.set('version','7');f.set('operation',op);f.set('name','Copy');if(confirmed)f.set('confirmation',uuid(2));return f;};
  for(const op of ['enable','archive'])assert.ok((await actions.manageAutomation(form(op,false))).error);
  for(const op of ['enable','disable','duplicate','archive'])await actions.manageAutomation(form(op));
  assert.deepEqual(calls.slice(2).map(c=>c[0]),['setAutomationEnabled','setAutomationEnabled','duplicateAutomation','archiveAutomation']);assert.equal(calls[2][3],true);assert.equal(calls[3][3],false);
  const source=fs.readFileSync('src/app/app/administration/automations/actions.ts','utf8');assert.doesNotMatch(source,/set_automation_processing|createAdminClient|execute_automation_ticket_step/);
});
test('conflicts and recoverable validation leave the mounted draft and provide focused feedback',()=>{
  const builder=fs.readFileSync('src/features/automation/builder.tsx','utf8');assert.match(builder,/result.error.code==='conflict'/);assert.match(builder,/Your draft is preserved/);assert.match(builder,/focus.current=`action-\$\{item.id\}`/);assert.match(builder,/aria-live="polite"/);
  const form=fs.readFileSync('src/components/ui/action-form.tsx','utf8');assert.match(form,/feedback.current\?\.focus/);
  const css=fs.readFileSync('src/app/globals.css','utf8');assert.match(css,/@media \(max-width: 767px\)[\s\S]*automation-condition-grid[\s\S]*grid-template-columns: minmax\(0,1fr\)/);assert.match(css,/prefers-reduced-motion/);
});
test('condition text handles prototype-like words as literal text',()=>{
  for(const value of ['constructor','toString','__proto__'])assert.equal(model.valueLabel(value),value);
});
