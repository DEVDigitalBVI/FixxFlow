import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';
const id='10000000-0000-4000-8000-000000000001';
function setup(role='technician',failure=null) {
 const calls=[];
 const api=load('src/features/lookups/service.ts',{
  '@/lib/auth/viewer':{requireViewer:async()=>({role,organizationId:'trusted-org'})},
  '@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push(args);return{data:[],error:failure};}})},
 });return {...api,calls};
}
test('invalid cursors/resources and employee directory access fail before queries',async()=>{
 for(const params of [{resource:'secrets'},{resource:'people',cursor:'not-json'},{resource:'teams',selected:'bad'}, {resource:'subcategories',parent:'bad'}]){
  const api=setup();await assert.rejects(api.lookupChoices(new URLSearchParams(params)),api.LookupInputError);assert.equal(api.calls.length,0);
 }
 const api=setup('end_user');await assert.rejects(api.lookupChoices(new URLSearchParams({resource:'people'})),api.LookupInputError);assert.equal(api.calls.length,0);
});
test('lookup derives the tenant and explicitly retrieves selected values outside the search',async()=>{
 const api=setup();await api.lookupChoices(new URLSearchParams({resource:'teams',q:'  Alpha  beta ',selected:id,org:'attacker-org',active:'all'}));
 assert.equal(api.calls.length,2);assert.ok(api.calls.every(call=>call.org==='trusted-org'));
 assert.equal(api.calls[0].query,'Alpha beta');assert.equal(api.calls[1].selected,id);assert.equal(api.calls[1].query,undefined);
});
test('query failures remain failures, not empty choices',async()=>{
 const failure={code:'08006'};const api=setup('technician',failure);
 await assert.rejects(api.lookupChoices(new URLSearchParams({resource:'teams'})),error=>error===failure);
});
