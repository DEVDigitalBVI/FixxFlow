import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,mocks={}){const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;new Function('require','module','exports',code)(n=>mocks[n]??require(n),m,m.exports);return m.exports;}
test('platform guard denies tenants, challenges incomplete MFA and allows only ready owners',async()=>{
 for(const access of ['none','enroll','verify','ready']){const {requirePlatformOwner}=load('src/lib/auth/platform.ts',{react:{cache:fn=>fn},'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');},redirect:path=>{throw Error(path);}},'@/lib/supabase/server':{createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:'owner',email:'owner@example.test'}}})},rpc:async()=>({data:access})})}});if(access==='ready')assert.equal((await requirePlatformOwner()).id,'owner');else await assert.rejects(()=>requirePlatformOwner(),access==='none'?/NOT_FOUND/:/platform\/access/);}
});
test('platform mutations verify owner before parsing or executing data changes',async()=>{let touched=false;const {saveCustomer}=load('src/app/platform/actions.ts',{'next/cache':{revalidatePath:()=>{}},'@/lib/auth/platform':{requirePlatformOwner:async()=>{throw Error('DENIED');}},'@/lib/supabase/server':{createClient:async()=>{touched=true;}}});await assert.rejects(()=>saveCustomer(null,{},new FormData()),/DENIED/);assert.equal(touched,false);});
test('product event totals include assets without counting unique users',()=>{const {usageTotals}=load('src/features/platform/model.ts');const totals=usageTotals([{event:'asset_viewed',role:'end_user',surface:'assets',count:2},{event:'asset_viewed',role:'technician',surface:'assets',count:3}]);assert.equal(totals.find(r=>r.label==='Asset views').value,5);assert.equal(totals.find(r=>r.label==='Completed logins').value,0);});
