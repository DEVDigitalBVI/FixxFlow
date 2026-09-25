import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function load(file,mocks={}) {const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(name=>mocks[name]??require(name),m,m.exports);return m.exports;}
const presentation=load('src/features/audit/presentation.ts',{'@/features/tickets/presentation':load('src/features/tickets/presentation.ts'),'@/features/identity/role':load('src/features/identity/role.ts')});
test('audit values reuse status, priority and role labels with explicit unset values',()=>{
 assert.equal(presentation.auditValue('priority','normal'),'Normal');assert.equal(presentation.auditValue('status','in_progress'),'In progress');assert.equal(presentation.auditValue('assigned_technician_id',null),'Unassigned');assert.equal(presentation.auditValue('kind','internal_note'),'Internal note');assert.deepEqual(presentation.parseChanges(null),[]);
});
test('audit query scopes and paginates, escapes wildcard searches and preserves filters',async()=>{
 const calls=[];const rows=Array.from({length:51},(_,i)=>({id:i,actor_name:'Jamaal',entity_type:'tickets',entity_id:'ticket',entity_label:'Ticket #1042',action:'updated',created_at:'2026-09-25T14:42:00Z',changes:[{field:'priority',from:'normal',to:'high'},{field:'assigned_technician_id',from:null,to:'Michael'}]}));
 const builder=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>Promise.resolve({data:rows,error:null}).then(resolve):(...args)=>{calls.push([key,...args]);return builder;}});
 const {AuditLog}=load('src/features/audit/audit-log.tsx',{'next/link':{default:props=>React.createElement('a',props)},'./presentation':presentation,'@/lib/supabase/server':{createClient:async()=>({from:table=>{calls.push(['from',table]);return builder;}})}});
 const html=renderToStaticMarkup(await AuditLog({organizationId:'org',filters:{page:'2',q:'1042%_',entity:'tickets',action:'updated'}}));
 assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='organization_id'&&c[2]==='org'));assert.ok(calls.some(c=>c[0]==='range'&&c[1]===50&&c[2]===100));assert.ok(calls.some(c=>c[0]==='ilike'&&c[2]==='%1042\\%\\_%'));
 assert.equal((html.match(/Ticket #1042/g)||[]).length,51); // 50 events and search placeholder
 assert.match(html,/Normal/);assert.match(html,/High/);assert.match(html,/Unassigned/);assert.match(html,/Michael/);assert.match(html,/page=3&amp;q=1042%25_&amp;entity=tickets&amp;action=updated/);
});
test('invitation registration takes actor from the verified viewer, not the form',async()=>{
 let args;
 const {inviteMember}=load('src/app/app/people/actions.ts',{'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect:path=>{throw Error(path);}},'@/lib/auth/viewer':{requireViewer:async()=>({id:'verified-admin',organizationId:'org',role:'administrator'})},'@/lib/supabase/server':{createClient:async()=>{}},'@/lib/supabase/admin':{createAdminClient:()=>({auth:{admin:{inviteUserByEmail:async()=>({data:{user:{id:'invited-user'}},error:null})}},rpc:async(name,value)=>{assert.equal(name,'register_invited_member');args=value;return {error:null};}})}});
 const data=new FormData();for(const [k,v] of Object.entries({email:'new@example.test',displayName:'New User',role:'end_user',invited_by:'spoofed'}))data.set(k,v);
 await assert.rejects(()=>inviteMember(data),/Invitation sent/);assert.equal(args.invited_by,'verified-admin');assert.equal(args.invited_user_id,'invited-user');
});
