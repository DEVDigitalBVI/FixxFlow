import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const id='30000000-0000-0000-0000-000000000181';
function load(file,mocks) {
 const m={exports:{}};
 const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',compiled)(name=>mocks[name]??require(name),m,m.exports);
 return m.exports;
}
function action({role='administrator',result={data:{id},error:null}}={}) {
 const calls=[];
 const query={delete(){calls.push(['delete']);return this;},eq(...args){calls.push(['eq',...args]);return this;},select(...args){calls.push(['select',...args]);return this;},maybeSingle:async()=>result};
 const actions=load('src/app/app/organization/actions.ts',{
  'next/cache':{revalidatePath:path=>calls.push(['revalidate',path])},
  'next/navigation':{redirect:url=>{throw Error(decodeURIComponent(url));}},
  '@/lib/auth/viewer':{requireViewer:async()=>({role,organizationId:'own-org'})},
  '@/lib/supabase/server':{createClient:async()=>{calls.push(['client']);return {from:table=>{calls.push(['table',table]);return query;}};}},
 });
 return {actions,calls};
}
function form(confirmed=true){const f=new FormData();f.set('id',id);if(confirmed)f.set('confirmDelete',id);return f;}
for(const [method,table] of [['deleteDepartment','departments'],['deleteLocation','locations']]){
 test(`${method} requires an administrator and explicit confirmation before querying`,async()=>{
  for(const role of ['end_user','technician']){
   const {actions,calls}=action({role});await assert.rejects(()=>actions[method](form()),/Only administrators/);assert.deepEqual(calls,[]);
  }
  const {actions,calls}=action();await assert.rejects(()=>actions[method](form(false)),/Confirm/);assert.deepEqual(calls,[]);
  const invalid=form();invalid.set('id','invalid');await assert.rejects(()=>actions[method](invalid),/valid/);assert.deepEqual(calls,[]);
 });
 test(`${method} scopes deletion and returns success only for a removed row`,async()=>{
  const {actions,calls}=action();await assert.rejects(()=>actions[method](form()),/success=.*deleted/);
  assert.ok(calls.some(c=>c[0]==='table' && c[1]===table));
  assert.ok(calls.some(c=>c[0]==='eq' && c[1]==='organization_id' && c[2]==='own-org'));
  assert.ok(calls.some(c=>c[0]==='eq' && c[1]==='id' && c[2]===id));
  assert.ok(calls.some(c=>c[0]==='revalidate'));
  const stale=action({result:{data:null,error:null}});await assert.rejects(()=>stale.actions[method](form()),/no longer available/);
 });
 test(`${method} explains linked-record protection and supports failure recovery`,async()=>{
  const linked=action({result:{data:null,error:{code:'23503'}}});await assert.rejects(()=>linked.actions[method](form()),/Deactivate/);
  assert.ok(!linked.calls.some(c=>c[0]==='revalidate'));
  const offline=action({result:{data:null,error:{code:'network'}}});await assert.rejects(()=>offline.actions[method](form()),/try again/);
 });
}
test('organization controls retain both lifecycle actions and require named deletion confirmation',()=>{
 const {OrganizationItemActions}=load('src/features/administration/organization-item-actions.tsx',{
  'next/link':{default:props=>React.createElement('a',props)},
  '@/components/ui/submit-button':{SubmitButton:props=>{const button={...props};delete button.pendingLabel;return React.createElement('button',{...button,type:'submit'});}},
 });
 for(const active of [true,false]){
  const html=renderToStaticMarkup(React.createElement(OrganizationItemActions,{id,name:'Front desk',kind:'department',active,toggleAction:'/toggle',deleteAction:'/delete'}));
  assert.match(html,new RegExp(`aria-label="${active?'Deactivate':'Activate'} department Front desk"`));
  assert.match(html,/<details/);assert.match(html,/<summary>Delete/);
  assert.match(html,/Permanently delete “Front desk”/);
  assert.match(html,/<input(?=[^>]*name="confirmDelete")(?=[^>]*required="")[^>]*>/);
  assert.match(html,/aria-describedby="delete-description-/);
  assert.match(html,/Delete department/);assert.match(html,/>Cancel<\/a>/);
 }
});
