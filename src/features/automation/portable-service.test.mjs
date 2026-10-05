import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../../../tests/helpers/load-module.mjs';
import { definition, action, uuid, rule } from '../../../tests/fixtures/automation.mjs';

function fixture({role='administrator',mfa=false,foreign=false}={}) {
  const calls=[],source=rule({enabled:false,definition:definition({actions:[action('assign_team',{teamId:uuid(80)})]})});
  const row={id:source.id,organization_id:foreign?uuid(9):source.organizationId,definition:source.definition,enabled:false,version:1,created_by:source.createdBy,updated_by:source.createdBy,created_at:source.createdAt,updated_at:source.updatedAt,enabled_at:null,archived_at:null};
  const chain={select(){return chain;},eq(...args){calls.push(['eq',...args]);return chain;},async maybeSingle(){return {data:row,error:null};}};
  const client={from(table){calls.push(['from',table]);return chain;},async rpc(name,args){calls.push(['rpc',name,args]);return {data:{rows:[{id:uuid(80),label:'Network Team',active:true}]},error:null};}};
  const mocks={'server-only':{},'next/navigation':{notFound(){throw Error('NOT_FOUND');}},'@/lib/auth/viewer':{async requireViewer(){if(mfa)throw Error('MFA_REQUIRED');return{role,status:'active',organizationId:uuid(1),id:uuid(3)};}},'@/lib/supabase/server':{async createClient(){calls.push(['client']);return client;}}};
  return {calls,mocks,service:load('src/features/automation/portable-service.ts',mocks)};
}

test('export uses administrator session reads scoped to viewer organization, without mutations or source IDs',async()=>{
  const {service,calls}=fixture();const result=await service.exportAutomation(uuid(2));
  assert.equal(result.filename,'route-requests.fixxflow.json');assert.equal(result.package.references[0].sourceLabel,'Network Team');
  assert.ok(calls.some(call=>call[0]==='eq'&&call[1]==='organization_id'&&call[2]===uuid(1)));
  for(const call of calls.filter(c=>c[0]==='rpc')){assert.equal(call[1],'read_automation_admin');assert.equal(call[2].org,uuid(1));}
  assert.doesNotMatch(JSON.stringify(result.package),/00000000/);
});
for(const role of ['technician','end_user','platform_owner'])test(`${role} cannot export or open import, including platform ownership`,async()=>{
  const {service,calls,mocks}=fixture({role});await assert.rejects(service.exportAutomation(uuid(2)),/NOT_FOUND/);
  const page=load('src/app/app/administration/automations/import/page.tsx',{...mocks,'@/features/automation/import-automation':{},'@/features/automation/page-parts':{}}).default;
  await assert.rejects(page(),/NOT_FOUND/);assert.deepEqual(calls,[]);
});
test('MFA redirects remain authoritative before import or export reads',async()=>{
  const {service,calls,mocks}=fixture({mfa:true});await assert.rejects(service.exportAutomation(uuid(2)),/MFA_REQUIRED/);
  const page=load('src/app/app/administration/automations/import/page.tsx',{...mocks,'@/features/automation/import-automation':{},'@/features/automation/page-parts':{}}).default;
  await assert.rejects(page(),/MFA_REQUIRED/);assert.deepEqual(calls,[]);
});
test('cross-tenant returned rule is rejected before label discovery or export',async()=>{
  const {service,calls}=fixture({foreign:true});await assert.rejects(service.exportAutomation(uuid(9)),/could not be exported/);
  assert.equal(calls.some(c=>c[0]==='rpc'),false);
});
test('export download sets private no-store, JSON and sanitized attachment headers; errors reveal no internals',async()=>{
  const {service}=fixture();const {GET}=load('src/app/app/administration/automations/[ruleId]/export/route.ts',{'next/navigation':{unstable_rethrow(){}},'@/features/automation/portable-service':service});
  const response=await GET(new Request('http://localhost/export'),{params:Promise.resolve({ruleId:uuid(2)})});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-disposition'),/attachment; filename="route-requests.fixxflow.json"/);
  assert.equal((await response.json()).version,1);
  const failed=load('src/app/app/administration/automations/[ruleId]/export/route.ts',{'next/navigation':{unstable_rethrow(){}},'@/features/automation/portable-service':{exportAutomation(){throw Error('SECRET database credentials');}}});
  const error=await failed.GET(new Request('http://localhost/export'),{params:Promise.resolve({ruleId:uuid(2)})});assert.equal(error.status,400);assert.doesNotMatch(await error.text(),/SECRET|credentials/);
});
