import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from '../../../tests/helpers/load-module.mjs';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';
const worker='10000000-0000-0000-0000-000000000403',ticket='70000000-0000-0000-0000-000000000401',target='70000000-0000-0000-0000-000000000402';
const model=load('src/features/tickets/communications.ts');
function form(operation='save_draft'){const f=new FormData();for(const [k,v]of Object.entries({ticketId:ticket,targetId:target,operation,revision:'2',title:'Office connectivity update',body:'Our provider is restoring service.',groupId:target,dueAt:'2026-10-20T11:00',dueTimezone:'America/Tortola',ownerId:worker,name:'Leadership',userId:worker}))f.set(k,v);return f;}
test('communication validation separates drafts, explicit approval, audience limits and timezone-aware reminders',()=>{
 const parsed=model.communicationPayload(form(),'save_draft');assert.equal(parsed.data.next_update_at,'2026-10-20T15:00:00.000Z');assert.deepEqual(parsed.data.group_ids,[target]);
 for(const [key,value]of [['body','x'],['title','x'],['groupId','bad-id'],['dueAt','2026-02-30T11:00']]){const f=form();f.set(key,value);assert.ok(model.communicationPayload(f,'save_draft').error);}
 const many=form();many.delete('groupId');for(let i=0;i<11;i++)many.append('groupId',`70000000-0000-0000-0000-${String(i).padStart(12,'0')}`);assert.ok(model.communicationPayload(many,'save_draft').error);
 const approval=form('publish');assert.ok(model.communicationPayload(approval,'publish').error);approval.set('confirm','yes');assert.deepEqual(model.communicationPayload(approval,'publish').data,{});
 const plan=form('save_plan');plan.set('dueAt','');assert.equal(model.communicationPayload(plan,'save_plan').data.next_update_at,null);plan.set('ownerId','invalid');assert.ok(model.communicationPayload(plan,'save_plan').error);
});
test('communication actions guard employee access, approval confirmation and stale drafts',async()=>{
 for(const mode of ['employee','unconfirmed','lookup','conflict','success']){
 const calls=[];const {manageCommunication}=load('src/features/tickets/communication-actions.ts',{'@/lib/auth/viewer':{requireViewer:async()=>({role:mode==='employee'?'end_user':'technician',organizationId:'org'})},'@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:3,error:mode==='conflict'?{code:'PT409'}:null};}})},'next/cache':{revalidatePath(){}}});
 const f=form(mode==='unconfirmed'?'publish':'save_draft');if(mode==='lookup')f.set('lookupLoadError','true');
 const result=await manageCommunication(f);
 if(['employee','unconfirmed','lookup'].includes(mode)){assert.ok(result.error);assert.equal(calls.length,0);}else if(mode==='conflict'){assert.match(result.error,/draft is preserved/);}else{assert.ok(result.success);assert.equal(result.revision,3);assert.equal(calls[0][1].org,'org');assert.equal(calls[0][1].payload.next_update_at,'2026-10-20T15:00:00.000Z');}
 }
});
test('communication forms keep stable command IDs and preserve the reviewed revision after a conflict',async()=>{
 const props={ticketId:ticket,targetId:target,revision:2,operation:'save_draft',label:'Save draft'};
 const ui=componentHarness('src/features/tickets/communication-forms.tsx','CommunicationForm',props,{'./communication-actions':{manageCommunication:async()=>({error:'Conflict'})},'next/navigation':{useRouter:()=>({refresh(){}})}});
 try{await ui.find(n=>typeof n.props.action==='function').props.action(form());props.revision=3;props.targetId='new-id';ui.render();assert.equal(ui.find(n=>n.props.name==='revision').props.value,2);assert.equal(ui.find(n=>n.props.name==='targetId').props.value,target);assert.ok(ui.find(n=>n.props.target==='_blank'));assert.ok(ui.find(n=>n.type==='button'&&n.props.type==='button'));}finally{ui.close();}
});
test('draft editor uses labelled plain-text controls, saved group selections and the shared deadline field',()=>{
 const {DraftEditor}=load('src/features/tickets/communication-forms.tsx',{'@/features/timezones/provider':{useTimezone:()=> 'UTC'},'next/navigation':{useRouter:()=>({refresh(){}})},'./communication-actions':{manageCommunication:async()=>({})}});
 const html=renderToStaticMarkup(React.createElement(DraftEditor,{ticketId:ticket,targetId:target,groups:[{id:target,name:'Leadership'}],draft:{revision:2,title:'Saved update',body:'Saved message',group_ids:[target],next_update_at:null}}));
 assert.match(html,/<input(?=[^>]*name="title")(?=[^>]*required)[^>]*>/);assert.match(html,/name="body"[^>]*required/);assert.match(html,/name="groupId"[^>]*checked/);assert.match(html,/Next stakeholder update expected/);assert.match(html,/Nothing is sent until approval/);
});
test('stakeholder update page relies on recipient RLS and never offers employees an internal ticket link',async()=>{
 for(const role of ['end_user','technician']){
 const calls=[];const q=new Proxy({}, {get:(_,key)=>key==='maybeSingle'?async()=>({data:{id:target,ticket_id:ticket,title:'Approved message',body:'Service restored <script>',approved_at:'2026-10-20T15:00Z',next_update_at:null},error:null}):(...args)=>{calls.push([key,...args]);return q;}});
 const {default:Page}=load('src/app/app/incident-updates/[id]/page.tsx',{'@/lib/auth/viewer':{requireViewer:async()=>({role,organizationId:'org'})},'@/lib/supabase/server':{createClient:async()=>({from:()=>q})},'next/link':{default:({children,...props})=>React.createElement('a',props,children)},'@/features/timezones/provider':{Timestamp:({value})=>React.createElement('time',null,value)}});
 const html=renderToStaticMarkup(await Page({params:Promise.resolve({id:target})}));
 assert.match(html,/Service restored &lt;script&gt;/);assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='organization_id'&&c[2]==='org'));
 if(role==='end_user')assert.doesNotMatch(html,/Open coordination/);else assert.match(html,/Open coordination/);
 }
});
