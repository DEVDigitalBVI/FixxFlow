import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
function load(file,mocks={}){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(name=>mocks[name]??require(name),m,m.exports);return m.exports;}
const model=load('src/features/assets/model.ts');
const form=()=>{const f=new FormData();for(const [k,v] of Object.entries({tag:' pc-001 ',name:'Laptop',kind:'computer',status:'available'}))f.set(k,v);return f;};
test('asset validation normalizes tags and rejects invalid lifecycle and dates',()=>{
 assert.equal(model.assetInput(form()).data.tag,'PC-001');const f=form();f.set('kind','__proto__');assert.ok(model.assetInput(f).error);f.set('kind','computer');f.set('purchased_on','2026-09-20');f.set('warranty_until','2026-09-01');assert.match(model.assetInput(f).error,/Warranty/);f.set('warranty_until','2027-09-01');f.set('status','retired');f.set('assigned_user_id','11111111-1111-4111-8111-111111111111');assert.match(model.assetInput(f).error,/Unassign/);
});
test('pagination never sends negative or unbounded offsets',()=>{for(const p of ['NaN','Infinity','0','-9','1.5'])assert.equal(model.pageNumber(p),1);assert.equal(model.pageNumber('9999999'),100000);});
function actions(role,{data={id:'asset'},error=null}={}) {const calls=[];const builder=new Proxy({},{get:(_,key)=>key==='then'?resolve=>Promise.resolve({data,error}).then(resolve):(...args)=>{calls.push([key,...args]);return builder;}});return {...load('src/app/app/assets/actions.ts',{'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect:path=>{throw Error(path);}},'@/lib/auth/viewer':{requireViewer:async()=>({role,organizationId:'verified-org'})},'@/lib/supabase/server':{createClient:async()=>({from:t=>{calls.push(['from',t]);return builder;}})},'@/features/assets/model':model}),calls};}
test('employee mutation attempts stop before database access',async()=>{const a=actions('end_user');assert.match((await a.saveAsset(null,0,{},form())).error,/Only IT/);assert.match((await a.changeAssetLink('ticket',{},form())).error,/Only IT/);assert.equal(a.calls.length,0);});
test('asset writes use verified organization and stale revisions preserve the draft',async()=>{const a=actions('technician',{data:null});const f=form();f.set('organization_id','attacker-org');const result=await a.saveAsset('asset',4,{},f);assert.match(result.error,/changed/);assert.ok(a.calls.some(c=>c[0]==='eq'&&c[1]==='organization_id'&&c[2]==='verified-org'));assert.ok(a.calls.some(c=>c[0]==='eq'&&c[1]==='revision'&&c[2]===4));});
test('duplicate equipment tags have an actionable error',async()=>{const a=actions('administrator',{error:{code:'23505'}});assert.match((await a.saveAsset(null,0,{},form())).error,/already in use/);});
test('asset form exposes persistent labels, retirement guidance and native date fields',()=>{
 const {AssetForm}=load('src/features/assets/asset-form.tsx',{react:{...React,useState:v=>[v,()=>{}],useActionState:()=>[{},()=>{}],useEffect:()=>{},useRef:()=>({current:null})},'next/link':{default:p=>React.createElement('a',p)},'@/components/ui/submit-button':{SubmitButton:p=>React.createElement('button',p)},'@/app/app/assets/actions':{saveAsset:()=>{}},'./model':model});
 const html=renderToStaticMarkup(React.createElement(AssetForm,{people:[],locations:[]}));assert.match(html,/<label[^>]*>Asset tag/);assert.match(html,/type="date"/);assert.match(html,/Retirement preserves/);assert.doesNotMatch(html,/dangerouslySetInnerHTML/);
});
