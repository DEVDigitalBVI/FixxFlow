import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from '../../../tests/helpers/load-module.mjs';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';

const id='00000000-0000-4000-8000-000000000001';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
function service({role='administrator',status='active',deny=false,rpc=async()=>({data:{rows:[]}})}={}) {
  const calls=[];
  const api=load('src/features/automation/ui-service.ts',{
    'server-only':{},
    'next/navigation':{notFound:()=>{throw Error('DENIED');}},
    '@/lib/auth/viewer':{requireViewer:async()=>{calls.push('viewer');if(deny)throw Error('MFA');return{role,status,organizationId:'trusted-org'};}},
    '@/lib/supabase/server':{createClient:async()=>({rpc:(name,args)=>{calls.push(args);return rpc(name,args);}})},
  });
  return{...api,calls};
}

test('picker reads page and selected values concurrently after one administrator check',async()=>{
  const page=deferred(),selected=deferred();
  const api=service({rpc:(_name,args)=>args.selected.length?selected.promise:page.promise});
  const pending=api.automationPickerChoices('teams','Network',2,[id]);
  await settle();
  assert.equal(api.calls.filter(call=>call==='viewer').length,1);
  assert.equal(api.calls.length,3);
  for(const call of api.calls.slice(1))assert.equal(call.org,'trusted-org');
  assert.equal(api.calls[1].page_number,2);
  selected.resolve({data:{rows:[{id,label:'Previously selected',active:false}]}});
  const rows=Array.from({length:51},(_,i)=>({id:`team-${i}`,label:`Team ${i}`,active:true}));
  page.resolve({data:{rows}});
  const result=await pending;
  assert.equal(result.hasNext,true);assert.equal(result.rows.length,51);
  assert.equal(result.rows[0].id,id);
  assert.equal(result.rows.some(row=>row.id==='team-50'),false);
});

test('picker forbids technician/end-user/inactive/MFA reads and rejects malformed selectors',async()=>{
  for(const options of [{role:'technician'},{role:'end_user'},{status:'inactive'},{deny:true}]) {
    const api=service(options);
    await assert.rejects(()=>api.automationPickerChoices('teams'));
    assert.deepEqual(api.calls,['viewer']);
  }
  for(const [page,selected] of [[0,[]],[NaN,[]],[1,['invalid']],[1,Array(101).fill(id)]]) {
    const api=service();await assert.rejects(()=>api.automationPickerChoices('teams','',page,selected));
    assert.equal(api.calls.some(call=>typeof call==='object'),false);
  }
});

test('choice endpoint is private, bounded by the existing service, and preserves auth redirects',async()=>{
  const calls=[];let error=null;
  const {GET}=load('src/app/app/administration/automations/choices/route.ts',{
    'next/navigation':{unstable_rethrow:cause=>{if(cause.message==='MFA')throw cause;}},
    '@/features/automation/ui-service':{automationPickerChoices:async(...args)=>{calls.push(args);if(error)throw error;return{rows:[],hasNext:false};}},
  });
  const request=new Request(`https://app.example/app/administration/automations/choices?resource=teams&q=Network&page=2&selected=${id}&organizationId=untrusted`);
  const response=await GET(request);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(calls[0],['teams','Network',2,[id]]);
  error=Error('private database error');const failed=await GET(request);
  assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/private database/);
  error=Error('MFA');await assert.rejects(()=>GET(request),/MFA/);
});

test('choice client sends cancellable private GET requests, never Server Actions',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return Response.json({rows:[],hasNext:false});});
  const {loadAutomationChoices}=load('src/features/automation/choice-client.ts');
  const controller=new AbortController();
  await loadAutomationChoices('teams','Network & IT',3,[id],controller.signal);
  const url=new URL(calls[0].url,'https://app.example');
  assert.equal(url.searchParams.get('q'),'Network & IT');assert.deepEqual(url.searchParams.getAll('selected'),[id]);
  assert.equal(calls[0].options.signal,controller.signal);assert.equal(calls[0].options.cache,'no-store');
  assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.redirect,'error');
});

test('pickers start initial loads immediately, debounce searches, abort and ignore obsolete results',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const requests=[];
  const picker=componentHarness('src/features/automation/reference-picker.tsx','ReferencePicker',{resource:'teams',value:id,label:'Team',onChange:()=>{}},{
    './choice-client':{loadAutomationChoices:(...args)=>{const pending=deferred();requests.push({args,...pending});return pending.promise;}},
  });
  try {
    t.mock.timers.tick(0);assert.equal(requests.length,1);assert.deepEqual(requests[0].args[3],[id]);
    picker.find(node=>node.props.type==='search').props.onChange({target:{value:'new'}});picker.render();
    assert.equal(requests[0].args[4].aborted,true);
    t.mock.timers.tick(299);assert.equal(requests.length,1);
    t.mock.timers.tick(1);assert.equal(requests.length,2);
    requests[1].resolve({rows:[{id:'fresh',label:'Fresh',active:true}],hasNext:false});await settle();picker.render();
    requests[0].resolve({rows:[{id:'old',label:'Old',active:true}],hasNext:false});await settle();picker.render();
    assert.ok(picker.find(node=>node.type==='option'&&node.props.value==='fresh'));
    assert.equal(picker.all(node=>node.type==='option'&&node.props.value==='old').length,0);
  } finally {picker.close();}
  assert.equal(requests[1].args[4].aborted,true);
});

test('dry-run labels coalesce repeated references into one lookup per resource',async()=>{
  const api=service();
  await api.automationResultLabels({conditions:[{field:'category_id',expected:id,actual:id},{field:'category_id',expected:id,actual:null},{field:'team_id',expected:id,actual:null}]});
  const reads=api.calls.filter(call=>typeof call==='object');
  assert.equal(reads.length,2);
  assert.deepEqual(reads.map(call=>call.resource).sort(),['teams','ticket_categories']);
  for(const call of reads)assert.deepEqual(call.selected,[id]);
});
