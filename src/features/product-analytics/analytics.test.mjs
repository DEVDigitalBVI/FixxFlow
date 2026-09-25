import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
const require=createRequire(import.meta.url);
function load(file,mocks={}) {const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','module','exports',code)(name=>mocks[name]??require(name),m,m.exports);return m.exports;}
const events=load('src/features/product-analytics/events.ts');
test('browser events cannot claim mutations, assets or arbitrary properties',()=>{
 assert.equal(events.allowedPageEvent('ticket_created','tickets'),false);assert.equal(events.allowedPageEvent('asset_viewed','assets'),false);assert.equal(events.allowedPageEvent('ticket_viewed','knowledge'),false);assert.equal(events.allowedPageEvent('search_performed','tickets'),true);
});
test('views wait for visibility, avoid duplicate effects and clean up listeners',()=>{
 let effect,listener,count=0;const ref={current:false};
 const {UsageEvent}=load('src/features/product-analytics/usage-event.tsx',{react:{...React,useRef:()=>ref,useEffect:fn=>effect=fn},'./actions':{recordUsage:async(event,surface,id,token)=>{count++;assert.equal(event,'ticket_viewed');assert.equal(surface,'tickets');assert.equal(id,'ticket');assert.match(token,/^[0-9a-f-]{36}$/);}}});
 globalThis.document={visibilityState:'hidden',addEventListener:(_,fn)=>listener=fn,removeEventListener:()=>listener=null};
 try {UsageEvent({event:'ticket_viewed',surface:'tickets',targetId:'ticket'});const cleanup=effect();assert.equal(count,0);document.visibilityState='visible';listener();listener();assert.equal(count,1);cleanup();assert.equal(listener,null);}finally{delete globalThis.document;}
});
test('opted-out requests schedule no analytics and failures remain harmless',async()=>{
 let enabled=false,callback,rpcCalls=0;
 const {recordUsage,recordCompletedLogin}=load('src/features/product-analytics/actions.ts',{'next/server':{after:fn=>callback=fn},'@/lib/auth/viewer':{requireViewer:async()=>({usageSharing:enabled,organizationId:'org'})},'@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{rpcCalls++;assert.equal(name,'record_product_usage');assert.ok(!('query' in args));throw Error('unavailable');}})},'./events':events});
 await recordUsage('ticket_viewed','tickets','ticket','token');assert.equal(callback,undefined);enabled=true;await recordUsage('ticket_viewed','tickets','ticket','token');await callback();assert.equal(rpcCalls,1);await recordCompletedLogin();await callback();assert.equal(rpcCalls,2);
});
test('password failures and MFA challenges do not count as completed logins',async()=>{
 for(const fail of ['password','mfa',null]) {
  let tracked=0;
  const {signIn}=load('src/app/(auth)/actions.ts',{'next/navigation':{redirect:path=>{throw Error(path);}},'@/lib/auth/assurance':{requireAssurance:async()=>{if(fail==='mfa')throw Error('/auth/mfa');}},'@/lib/auth/form-values':{passwordValue:data=>data.get('password')},'@/lib/supabase/server':{createClient:async()=>({auth:{signInWithPassword:async()=>({error:fail==='password'?{}:null})}})},'@/features/product-analytics/actions':{recordCompletedLogin:async()=>tracked++}});
  const form=new FormData();form.set('email','test@example.test');form.set('password','password');await assert.rejects(()=>signIn(form));assert.equal(tracked,fail?0:1);
 }
});

test('usage preference belongs to the verified user and unchecked means opt-out',async()=>{
 let saved;
 const {updateUsagePreference}=load('src/app/app/profile/actions.ts',{'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect:path=>{throw Error(path);}},'@/lib/auth/viewer':{requireViewer:async()=>({id:'verified-user'})},'@/lib/supabase/server':{createClient:async()=>({from:table=>{assert.equal(table,'product_usage_preferences');return {upsert:async value=>{saved=value;return {error:null};}};}})}});
 const form=new FormData();form.set('user_id','someone-else');await assert.rejects(()=>updateUsagePreference(form),/Usage preference saved/);assert.deepEqual(saved,{user_id:'verified-user',enabled:false});form.set('shareUsage','on');await assert.rejects(()=>updateUsagePreference(form),/Usage preference saved/);assert.equal(saved.enabled,true);
});
