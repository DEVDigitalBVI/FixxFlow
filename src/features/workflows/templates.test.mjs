import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {randomUUID} from 'node:crypto';
import {load} from '../../../tests/helpers/load-module.mjs';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';
const model=load('src/features/workflows/model.ts'),owner='10000000-0000-0000-0000-000000000403',backup='10000000-0000-0000-0000-000000000405',template='70000000-0000-0000-0000-000000000401',ticket='70000000-0000-0000-0000-000000000402';
function definition(){return {...model.newWorkflowDefinition(randomUUID()),name:'Network maintenance',description:'Planned network work',steps:[{...model.newProcedureStep(randomUUID()),title:'Check connectivity'}]};}
function form(operation='save'){const f=new FormData();for(const [k,v]of Object.entries({templateId:template,operation,revision:'1',definition:JSON.stringify(definition()),confirm:'yes',changeNote:'Updated the company procedure',ticketId:ticket,ticketRevision:'1',version:'1',token:randomUUID(),ownerId:owner,backupId:backup,approverId:backup}))f.set(k,v);return f;}
test('workflow definitions enforce bounded role-based steps, unique groups and relative deadlines',()=>{
 const d=definition();assert.equal(model.validateWorkflowDefinition(d),undefined);assert.equal(model.needsBackup(d),false);assert.equal(model.needsApprover(d),false);
 for(const bad of [{...d,schema_version:2},{...d,steps:[]},{...d,steps:[d.steps[0],d.steps[0]]},{...d,steps:[{...d.steps[0],due_minutes:0}]},{...d,steps:[{...d.steps[0],approval_required:true,approval_minutes:null}]},{...d,communication:{...d.communication,group_names:['Ops','ops']}},{...d,escalation:{...d.escalation,acknowledgement_minutes:'30'}},{...d,extra:'unsupported'}])assert.ok(model.validateWorkflowDefinition(bad));
 const roles={...d,steps:[{...d.steps[0],assignee:'backup',approval_required:true}]};assert.equal(model.needsBackup(roles),true);assert.equal(model.needsApprover(roles),true);
});
test('template actions enforce administrator publishing, saved drafts and stale revision feedback',async()=>{
 for(const mode of ['technician','invalid','unconfirmed','conflict','success']){
 const calls=[];const {manageWorkflowTemplate}=load('src/features/workflows/actions.ts',{'@/lib/auth/viewer':{requireViewer:async()=>({role:mode==='technician'?'technician':'administrator',organizationId:'org'})},'@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:2,error:mode==='conflict'?{code:'PT409'}:null};}})},'next/cache':{revalidatePath(){}}});
 const f=form(mode==='unconfirmed'?'publish':'save');if(mode==='invalid')f.set('definition','{}');if(mode==='unconfirmed')f.delete('confirm');const result=await manageWorkflowTemplate(f);
 if(['technician','invalid','unconfirmed'].includes(mode)){assert.ok(result.error);assert.equal(calls.length,0);}else if(mode==='conflict')assert.match(result.error,/draft is preserved/);else{assert.equal(result.revision,2);assert.equal(calls[0][1].org,'org');assert.equal(calls[0][1].payload.definition.steps.length,1);}
 }
});
test('application actions preserve receipt tokens, guard lookups and require explicit confirmation',async()=>{
 for(const mode of ['employee','lookup','unconfirmed','conflict','success']){
 const calls=[];const {applyWorkflowTemplate}=load('src/features/workflows/actions.ts',{'@/lib/auth/viewer':{requireViewer:async()=>({role:mode==='employee'?'end_user':'technician',organizationId:'org'})},'@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push([name,args]);return {data:'receipt',error:mode==='conflict'?{code:'PT409'}:null};}})},'next/cache':{revalidatePath(){}}});const f=form();if(mode==='lookup')f.set('lookupLoadError','true');if(mode==='unconfirmed')f.delete('confirm');const result=await applyWorkflowTemplate(f);
 if(['employee','lookup','unconfirmed'].includes(mode)){assert.ok(result.error);assert.equal(calls.length,0);}else if(mode==='conflict')assert.match(result.error,/selections are preserved/);else{assert.match(result.redirectTo,/ticket-procedures/);assert.equal(calls[0][1].token,f.get('token'));assert.equal(calls[0][1].version,1);}
 }
});
test('template builder preserves drafts and revisions, tracks structural edits and gives keyboard alternatives to drag',async()=>{
 const props={templateId:template,revision:1,initial:definition()},guards=[];
 const ui=componentHarness('src/features/workflows/template-builder.tsx','TemplateBuilder',props,{'./actions':{manageWorkflowTemplate:async()=>({error:'Conflict'})},'@/components/ui/unsaved-changes':{useUnsavedChanges:dirty=>{guards.push(dirty);return()=>{};},confirmDiscardChanges:()=>true}});
 try{
 const data=()=>JSON.parse(ui.find(n=>n.props.name==='definition').props.value);
 assert.equal(data().steps.length,1);ui.find(n=>n.type==='button'&&n.props.children==='Add response step').props.onClick();ui.render();assert.equal(data().steps.length,2);assert.equal(guards.at(-1),true);assert.ok(ui.focuses.some(id=>id.endsWith('-title')));
 ui.find(n=>n.props['aria-label']==='Move step 1 down').props.onClick();ui.render();assert.equal(data().steps[1].title,'Check connectivity');
 ui.find(n=>n.props['aria-label']==='Remove step 1').props.onClick();ui.render();assert.equal(data().steps.length,1);assert.equal(data().steps[0].title,'Check connectivity');
 await ui.find(n=>typeof n.props.action==='function').props.action(form());props.revision=2;props.initial={...props.initial,name:'Remote draft edit'};ui.render();assert.equal(ui.find(n=>n.props.name==='revision').props.value,1);assert.equal(data().name,'Network maintenance');assert.ok(ui.find(n=>n.props.target==='_blank'));
 }finally{ui.close();}
});
test('published preview escapes content and explains deadlines and manual stakeholder delivery',()=>{
 const {DefinitionPreview}=load('src/features/workflows/definition-preview.tsx');const d=definition();d.steps[0].instructions='<script>Unsafe</script>';const html=renderToStaticMarkup(React.createElement(DefinitionPreview,{definition:d}));assert.match(html,/&lt;script&gt;Unsafe&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/calendar minutes/);assert.match(html,/never sends stakeholder messages automatically/);
});
test('catalog access and literal searches stay within the company and use bounded server pagination',async()=>{
 for(const role of ['end_user','technician','administrator']){
 const calls=[];const q=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>resolve({data:[],count:0,error:null}):(...args)=>{calls.push([key,...args]);return q;}});
 const {WorkflowCatalog}=load('src/features/workflows/catalog.tsx',{'@/lib/auth/viewer':{requireViewer:async()=>({role,organizationId:'org'})},'@/lib/supabase/server':{createClient:async()=>({from:()=>q})},'next/navigation':{notFound(){throw Error('NOT_FOUND');}},'next/link':{default:props=>React.createElement('a',props)}});
 if(role==='end_user'){await assert.rejects(()=>WorkflowCatalog({params:{}}),/NOT_FOUND/);assert.equal(calls.length,0);continue;}
 const html=renderToStaticMarkup(await WorkflowCatalog({params:{q:'25%_',page:'2',ticket}}));assert.match(html,/No procedures found/);assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='organization_id'&&c[2]==='org'));assert.ok(calls.some(c=>c[0]==='gt'&&c[1]==='latest_version'&&c[2]===0));assert.ok(calls.some(c=>c[0]==='range'&&c[1]===20&&c[2]===39));assert.ok(calls.find(c=>c[0]==='ilike')[2].includes('\\%'));
 }
});

test('publishing a saved draft advances metadata revision without stranding the open editor',()=>{
 const props={templateId:template,revision:2,initial:definition()};
 const ui=componentHarness('src/features/workflows/template-builder.tsx','TemplateBuilder',props,{'@/components/ui/unsaved-changes':{useUnsavedChanges:()=>()=>{},confirmDiscardChanges:()=>true}});
 try{props.revision=3;ui.render();assert.equal(ui.find(n=>n.props.name==='revision').props.value,3);}finally{ui.close();}
});
