import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from '../../../tests/helpers/load-module.mjs';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';
const model=load('src/features/tickets/response-checklist.ts');
const worker='10000000-0000-0000-0000-000000000403',ticket='70000000-0000-0000-0000-000000000401',step='70000000-0000-0000-0000-000000000402';
function form(){const f=new FormData();for(const [k,v] of Object.entries({ticketId:ticket,stepId:step,operation:'add',revision:'0',title:'Contact provider',instructions:'Check outage',assigneeId:worker,dueAt:'2026-10-20T11:00',dueTimezone:'America/Tortola'}))f.set(k,v);return f;}
test('step validation uses the existing timezone conversion and rejects invalid content and DST ambiguity',()=>{
 assert.equal(model.parseStep(form()).data.due_at,'2026-10-20T15:00:00.000Z');
 for(const [k,v] of [['title','x'],['instructions','x'.repeat(4001)],['assigneeId','invalid'],['dueAt','2026-02-30T10:00'],['dueTimezone','invalid']]){const f=form();f.set(k,v);assert.ok(model.parseStep(f).error);}
 const f=form();f.set('dueTimezone','America/New_York');f.set('dueAt','2026-11-01T01:30');assert.ok(model.parseStep(f).error);f.set('dueOccurrence','later');assert.equal(model.parseStep(f).data.due_at,'2026-11-01T06:30:00.000Z');
 f.set('dueAt','');assert.equal(model.parseStep(f).data.due_at,null);
});
test('step state conveys overdue, acknowledgement and completion in words',()=>{
 const s={due_at:'2026-10-19T01:00Z',acknowledged_at:null,completed_at:null};
 assert.equal(model.stepState(s,Date.parse('2026-10-19T02:00Z')),'Overdue · awaiting acknowledgement');
 s.acknowledged_at='2026-10-19T01:30Z';assert.match(model.stepState(s,Date.parse('2026-10-19T02:00Z')),/Overdue · acknowledged/);
 s.completed_at='2026-10-19T02:00Z';assert.equal(model.stepState(s),'Completed');
});
test('step server action checks permissions, unresolved lookups and stale edits before feedback',async()=>{
 for(const mode of ['employee','lookup','invalid','conflict','success']){
 const calls=[];const {changeStep}=load('src/features/tickets/checklist-actions.ts',{'@/lib/auth/viewer':{requireViewer:async()=>({role:mode==='employee'?'end_user':'technician',organizationId:'org'})},'@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push([name,args]);return{data:2,error:mode==='conflict'?{code:'PT409'}:null};}})},'next/cache':{revalidatePath(){}}});
 const f=form();if(mode==='lookup')f.set('lookupLoadError','true');if(mode==='invalid')f.set('stepId','invalid');
 const result=await changeStep(f);
 if(['employee','lookup','invalid'].includes(mode)){assert.ok(result.error);assert.equal(calls.length,0);}else if(mode==='conflict'){assert.match(result.error,/draft is preserved/);}else{assert.equal(result.revision,2);assert.equal(calls[0][1].payload.due_at,'2026-10-20T15:00:00.000Z');assert.equal(calls[0][1].org,'org');}
 }
});
test('checklist editor preserves draft and revision on failure, pins add IDs, and offers explicit recovery',async()=>{
 const props={ticketId:ticket,stepId:step,assigneeId:worker,step:{id:step,title:'Call provider',revision:2,due_at:null,assignee_id:worker,instructions:'Check outage'}};
 const ui=componentHarness('src/features/tickets/checklist-editor.tsx','ChecklistEditor',props,{'./checklist-actions':{changeStep:async()=>({error:'Conflict'})},'next/navigation':{useRouter:()=>({refresh(){}})},'@/features/timezones/provider':{useTimezone:()=> 'UTC'}});
 try{await ui.find(n=>typeof n.props.action==='function').props.action(form());props.step={...props.step,revision:3,title:'Remote change'};props.stepId='new-id';ui.render();assert.equal(ui.find(n=>n.props.name==='revision').props.value,2);assert.equal(ui.find(n=>n.props.name==='stepId').props.value,step);assert.equal(ui.find(n=>n.props.name==='title').props.defaultValue,'Call provider');assert.ok(ui.find(n=>n.props.target==='_blank'));assert.ok(ui.find(n=>n.type==='button'&&n.props.type==='button'));}finally{ui.close();}
});
test('checklist panel renders safe staff-only actions, history and failure recovery',async()=>{
 const record={id:step,assignee_id:worker,title:'Call <provider>',instructions:'Check service',due_at:null,acknowledged_at:null,completed_at:null,revision:1};
 for(const mode of ['employee','empty','pending','acknowledged','completed','error','history-error']){
 const row={...record,acknowledged_at:['acknowledged','completed'].includes(mode)?'2026-10-19T15:00Z':null,completed_at:mode==='completed'?'2026-10-19T16:00Z':null};
 const queries=[];const {ChecklistPanel}=load('src/features/tickets/checklist-panel.tsx',{'@/lib/auth/viewer':{requireViewer:async()=>({id:worker,organizationId:'org',role:mode==='employee'?'end_user':'technician'})},'@/lib/supabase/server':{createClient:async()=>({from(table){const q=new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>resolve({data:table==='incident_steps'?(mode==='empty'?[]:[row]):[],error:mode==='error'&&table==='incident_steps'||mode==='history-error'&&table==='incident_step_history'?{}:null}):(...args)=>{queries.push([table,key,...args]);return q;}});return q;}})},'@/features/lookups/labels':{profileLabels:async()=>[{user_id:worker,display_name:'Technician'}]},'./checklist-editor':{ChecklistEditor:()=>React.createElement('div',null,'Editor'),ChecklistStepAction:({operation})=>React.createElement('button',null,operation)},'@/features/timezones/provider':{Timestamp:({value})=>React.createElement('time',null,value)},'@/components/ui/retry-button':{RetryButton:()=>React.createElement('button',null,'Retry')}});
 const html=renderToStaticMarkup(await ChecklistPanel({organizationId:'org',ticketId:ticket,ownerId:worker}));
 if(mode==='employee'){assert.equal(html,'');assert.equal(queries.length,0);continue;}
 assert.ok(queries.some(q=>q[1]==='eq'&&q[2]==='organization_id'&&q[3]==='org'));
 if(mode==='error'){assert.match(html,/could not load/);continue;}
 assert.match(html,/IT staff only/);
 if(mode==='empty')assert.match(html,/No response steps/);
 else{assert.match(html,/Call &lt;provider&gt;/);assert.match(html,mode==='completed'?/>reopen</:mode==='acknowledged'?/>complete</:/>acknowledge</);}
 if(mode==='history-error')assert.match(html,/Response history could not load/);
 }
});

test('earlier history uses cursor pagination with retry and a bounded page of saved changes',async()=>{
 const initial=[{id:100,actor_id:worker,snapshot:{title:'Latest',revision:2,assignee_id:worker,instructions:'',due_at:null},created_at:'2026-10-19T01:00Z',action:'edited'}];
 let fail=true,cursor;
 const ui=componentHarness('src/features/tickets/checklist-history.tsx','ChecklistHistory',{ticketId:ticket,initial,initialNames:{[worker]:'Technician'},initialHasMore:true},{'./checklist-actions':{olderStepHistory:async(id,before)=>{cursor=before;return fail?{error:'Retry history'}:{rows:[{...initial[0],id:50}],names:{[worker]:'Technician'},hasMore:false};}}});
 try{
  const action=()=>ui.find(n=>typeof n.props.action==='function').props.action(new FormData());
  assert.match((await action()).error,/Retry/);assert.equal(cursor,100);ui.render();assert.equal(ui.all(n=>n.type==='li').length,1);
  fail=false;assert.ok((await action()).success);ui.render();assert.equal(ui.all(n=>n.type==='li').length,1);assert.equal(ui.find(n=>n.type==='li').key,'50');assert.equal(ui.all(n=>typeof n.props.action==='function').length,0);
  ui.find(n=>n.type==='button').props.onClick();ui.render();assert.equal(ui.find(n=>n.type==='li').key,'100');
 }finally{ui.close();}
});
