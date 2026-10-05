import assert from 'node:assert/strict';
import test from 'node:test';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const factors = [{id:'primary',friendly_name:'Phone',status:'verified'}, {id:'backup',friendly_name:'Backup',status:'verified'}, {id:'draft',status:'unverified'}];
function setup({destination='/app',list=async()=>({data:{totp:factors},error:null}),verifyError=null}={}) {
  const calls=[];
  const mfa={listFactors:list,challenge:async args=>{calls.push(['challenge',args]);return {data:{id:'challenge'},error:null};},verify:async args=>{calls.push(['verify',args]);return {error:verifyError};}};
  const harness=componentHarness('src/features/auth/mfa-challenge.tsx','MfaChallenge',{destination},{
    '@/lib/supabase/client':{createClient:()=>({auth:{mfa}})},
    '@/features/product-analytics/actions':{recordCompletedLogin:async()=>{}},
    'next/navigation':{useRouter:()=>({replace:path=>calls.push(['replace',path]),refresh:()=>calls.push(['refresh'])})},
  });
  return {harness,calls};
}
function form(factorId='backup') {const data=new FormData();data.set('factorId',factorId);data.set('code','123456');return data;}

test('MFA lists only verified factors and verifies the selected backup for both destinations',async()=>{
  for(const destination of ['/app','/platform']) {
    const {harness:h,calls}=setup({destination});
    try {
      assert.equal(h.find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);
      await tick();h.render();
      assert.deepEqual(h.all(n=>n.type==='option').map(n=>n.props.value),['primary','backup']);
      assert.equal(h.find(n=>n.type==='label'&&n.props.htmlFor==='factorId').props.children,'Authenticator');
      h.find(n=>n.props.id==='code').props.onChange({target:{value:'654321'}});h.render();
      h.find(n=>n.type==='select').props.onChange({target:{value:'backup'}});h.render();
      assert.equal(h.find(n=>n.props.id==='code').props.value,'');
      await h.find(n=>n.type==='form').props.action(form());h.render();
      assert.deepEqual(calls,[['challenge',{factorId:'backup'}],['verify',{factorId:'backup',challengeId:'challenge',code:'123456'}],['replace',destination],['refresh']]);
    }finally{h.close();}
  }
});
test('MFA handles list failures and supports retry without granting access',async()=>{
  let failed=true;
  const {harness:h,calls}=setup({list:async()=>{if(failed)throw Error('offline');return {data:{totp:factors},error:null};}});
  try {
    await tick();h.render();
    assert.match(h.find(n=>n.props.role==='alert').props.children,/could not load/);
    assert.ok(h.focuses.length);
    await h.find(n=>n.type==='form').props.action(form());assert.deepEqual(calls,[]);
    failed=false;h.find(n=>n.type==='button'&&n.props.type==='button').props.onClick();h.render();await tick();h.render();
    assert.equal(h.find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,false);
  }finally{h.close();}
});
test('MFA rejects removed and unverified factors before challenging',async()=>{
  for(const selected of ['backup','draft']) {
    let reads=0;
    const {harness:h,calls}=setup({list:async()=>({data:{totp:++reads===1?factors:[factors[0],factors[2]]},error:null})});
    try {await tick();h.render();await h.find(n=>n.type==='form').props.action(form(selected));h.render();assert.deepEqual(calls,[]);assert.match(h.find(n=>n.props.role==='alert').props.children,/no longer available/);}finally{h.close();}
  }
});
test('MFA preserves code and selection when verification fails',async()=>{
  const {harness:h,calls}=setup({verifyError:{message:'invalid'}});
  try {await tick();h.render();h.find(n=>n.type==='select').props.onChange({target:{value:'backup'}});h.find(n=>n.props.id==='code').props.onChange({target:{value:'123456'}});h.render();await h.find(n=>n.type==='form').props.action(form());h.render();assert.equal(h.find(n=>n.type==='select').props.value,'backup');assert.equal(h.find(n=>n.props.id==='code').props.value,'123456');assert.equal(h.find(n=>n.props.id==='code').props['aria-describedby'],'mfa-error');assert.ok(!calls.some(([name])=>name==='replace'));}finally{h.close();}
});
test('MFA empty factors provide recovery feedback and disable verification',async()=>{
  const {harness:h}=setup({list:async()=>({data:{totp:[]},error:null})});
  try {await tick();h.render();assert.match(h.find(n=>n.props.role==='alert').props.children,/No verified/);assert.equal(h.find(n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);}finally{h.close();}
});
