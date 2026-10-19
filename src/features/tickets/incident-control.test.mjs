import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from '../../../tests/helpers/load-module.mjs';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';
const owner='10000000-0000-0000-0000-000000000403',approver='10000000-0000-0000-0000-000000000405',backup='10000000-0000-0000-0000-000000000406',ticket='70000000-0000-0000-0000-000000000401',target='70000000-0000-0000-0000-000000000402';
const model=load('src/features/tickets/incident-control.ts');
function form(operation='request_approval'){const f=new FormData();for(const [k,v]of Object.entries({ticketId:ticket,targetId:target,operation,revision:'1',title:'Approve failover',description:'Approve the alternate circuit',approverId:approver,backupApproverId:backup,stepId:'',dueAt:'2026-10-20T11:00',dueTimezone:'America/Tortola',backupOwnerId:backup,enabled:'yes',acknowledgementMinutes:'30',overdueMinutes:'15',note:'Reviewed the impact',confirm:'yes'}))f.set(k,v);return f;}
test('incident controls validate time limits, distinct approvers, explicit decisions and required deadlines',()=>{
 assert.equal(model.parseControl(form(),'request_approval').data.due_at,'2026-10-20T15:00:00.000Z');
 for(const [key,value]of [['approverId','invalid'],['backupApproverId',approver],['dueAt',''],['description','no']]){const f=form();f.set(key,value);assert.ok(model.parseControl(f,'request_approval').error);}
 for(const [key,value]of [['acknowledgementMinutes','0'],['overdueMinutes','1441'],['overdueMinutes',''],['backupOwnerId','']]){const f=form('save_policy');f.set(key,value);assert.ok(model.parseControl(f,'save_policy').error);}
 const off=form('save_policy');off.delete('enabled');off.set('backupOwnerId','');assert.equal(model.parseControl(off,'save_policy').data.enabled,false);
 for(const op of ['approve','reject','cancel_approval','take_over']){const f=form(op);f.delete('confirm');assert.ok(model.parseControl(f,op).error);}
});
test('backup eligibility is independent of requester and only begins at the deadline',()=>{
 const a={status:'pending',requested_by:owner,approver_id:approver,backup_approver_id:backup,due_at:'2026-10-20T15:00:00Z',superseded_by:null};
 const before=Date.parse('2026-10-20T14:59:00Z'),due=Date.parse(a.due_at);
 assert.equal(model.mayDecide(a,owner,due),false);assert.equal(model.mayDecide(a,approver,before),true);assert.equal(model.mayDecide(a,backup,before),false);assert.equal(model.mayDecide(a,backup,due),true);assert.equal(model.mayDecide({...a,superseded_by:'replacement'},backup,due),false);
});
test('incident control actions block employees, unresolved staff, self-approval and stale submissions',async()=>{
 for(const mode of ['employee','lookup','self','conflict','success']){
 const calls=[];const {manageIncidentControl}=load('src/features/tickets/incident-control-actions.ts',{'@/lib/auth/viewer':{requireViewer:async()=>({id:owner,role:mode==='employee'?'end_user':'technician',organizationId:'org'})},'@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:2,error:mode==='conflict'?{code:'PT409'}:null};}})},'next/cache':{revalidatePath(){}}});
 const f=form();if(mode==='lookup')f.set('lookupLoadError','true');if(mode==='self')f.set('approverId',owner);
 const result=await manageIncidentControl(f);
 if(['employee','lookup','self'].includes(mode)){assert.ok(result.error);assert.equal(calls.length,0);}else if(mode==='conflict'){assert.match(result.error,/draft is preserved/);}else{assert.ok(result.success);assert.equal(calls[0][1].org,'org');assert.equal(calls[0][1].payload.due_at,'2026-10-20T15:00:00.000Z');}
 }
});
test('control editors preserve their command and revision after conflicts and provide explicit recovery',async()=>{
 const props={ticketId:ticket,targetId:target,revision:1,operation:'save_policy',label:'Save policy'};
 const ui=componentHarness('src/features/tickets/incident-control-forms.tsx','IncidentControlForm',props,{'./incident-control-actions':{manageIncidentControl:async()=>({error:'Conflict'})},'next/navigation':{useRouter:()=>({refresh(){}})}});
 try{await ui.find(n=>typeof n.props.action==='function').props.action(form());props.targetId='remote';props.revision=2;ui.render();assert.equal(ui.find(n=>n.props.name==='targetId').props.value,target);assert.equal(ui.find(n=>n.props.name==='revision').props.value,1);assert.ok(ui.find(n=>n.props.target==='_blank'));assert.ok(ui.find(n=>n.type==='button'));}finally{ui.close();}
});
test('approval request fields use persistent labels, native validation and the shared timezone-aware deadline',()=>{
 const {ApprovalRequestEditor}=load('src/features/tickets/incident-control-forms.tsx',{'@/features/timezones/provider':{useTimezone:()=> 'UTC'},'next/navigation':{useRouter:()=>({refresh(){}})}});
 const html=renderToStaticMarkup(React.createElement(ApprovalRequestEditor,{ticketId:ticket,targetId:target,steps:[{id:target,title:'Switch circuit'}]}));
 assert.match(html,/<input(?=[^>]*name="title")(?=[^>]*required)[^>]*>/);assert.match(html,/<input(?=[^>]*name="dueAt")(?=[^>]*required)[^>]*>/);assert.match(html,/Nobody|requester cannot approve/);assert.match(html,/name="stepId"/);assert.match(html,/Standalone decision/);assert.match(html,/Primary approver/);assert.match(html,/Backup approver/);
});
test('incident controls are staff-only, show saved work and limit decisions to eligible reviewers',async()=>{
 const approval={id:target,organization_id:'org',ticket_id:ticket,title:'Approve <failover>',description:'Saved decision details',step_id:target,step_work_version:1,step_snapshot:{title:'Saved failover step',instructions:'Use the standby route',assignee_id:owner,due_at:null},approver_id:approver,backup_approver_id:backup,requested_by:owner,requested_at:'2026-10-20T10:00Z',status:'pending',due_at:'2099-01-01T00:00Z',superseded_by:null,revision:1};
 for(const role of ['employee','owner','approver','backup','error']){
 const calls=[];const {IncidentControlPanel}=load('src/features/tickets/incident-control-panel.tsx',{'@/lib/auth/viewer':{requireViewer:async()=>({id:role==='approver'?approver:role==='backup'?backup:owner,role:role==='employee'?'end_user':'technician',organizationId:'org'})},'@/lib/supabase/server':{createClient:async()=>({from(table){let mode='';const result=()=>({data:table==='incident_approvals'?(mode==='recent'?[]:[approval]):table==='incident_steps'?[{id:target,title:'Failover step',work_version:1,completed_at:null}]:table==='incident_escalation_policies'?{backup_owner_id:backup,enabled:true,acknowledgement_minutes:30,overdue_minutes:15,revision:1}:[],error:role==='error'?{}:null});const q=new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>resolve(result()):key==='maybeSingle'?async()=>result():(...args)=>{calls.push([key,...args]);if(key==='neq')mode='recent';return q;}});return q;}})},'@/features/lookups/labels':{profileLabels:async()=>[owner,approver,backup].map(user_id=>({user_id,display_name:'Staff member'}))},'@/features/timezones/provider':{Timestamp:({value})=>React.createElement('time',null,value)},'./incident-control-forms':{EscalationEditor:()=>React.createElement('div',null,'Escalation editor'),ApprovalRequestEditor:()=>React.createElement('div',null,'Request editor'),ApprovalDecisionForm:({operation})=>React.createElement('button',null,operation),IncidentControlForm:({children})=>React.createElement('div',null,children)},'./incident-control-history':{IncidentControlHistory:()=>null},'@/components/ui/retry-button':{RetryButton:()=>React.createElement('button',null,'Retry')}});
 const html=renderToStaticMarkup(await IncidentControlPanel({organizationId:'org',ticketId:ticket,ownerId:owner}));
 if(role==='employee'){assert.equal(html,'');assert.equal(calls.length,0);continue;}
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='organization_id'&&c[2]==='org'));
 if(role==='error'){assert.match(html,/could not load/);continue;}
 assert.match(html,/Approve &lt;failover&gt;/);assert.match(html,/Use the standby route/);assert.match(html,/Review saved step details/);
 if(role==='approver'){assert.match(html,/>approve</);assert.match(html,/>reject</);}else assert.doesNotMatch(html,/>approve</);
 if(role==='owner')assert.match(html,/Request editor/);else assert.doesNotMatch(html,/Request editor/);
 if(role==='backup')assert.match(html,/can decide after the deadline/);
 }
});
