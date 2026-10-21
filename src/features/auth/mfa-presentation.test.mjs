import test from 'node:test';
import assert from 'node:assert/strict';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';

for(const [name,response,label] of [
 ['unconfigured',{data:{totp:[]}},'Two-step verification is not set up'],
 ['protected',{data:{totp:[{id:'factor',status:'verified',friendly_name:'Work phone'}]}},'Two-step verification enabled'],
 ['unavailable',{error:{message:'offline'}},'Account protection could not load.'],
])test(`account protection distinguishes loading from ${name}`,async()=>{
 const mfa={listFactors:async()=>response};
 const h=componentHarness('src/features/auth/mfa-enrollment.tsx','MfaEnrollment',{}, {'next/image':{default:()=>null},'@/lib/supabase/client':{createClient:()=>({auth:{mfa}})}});
 try{
  assert.ok(h.find(n=>n.props.role==='status'&&n.props.children==='Checking account protection…'));
  await new Promise(resolve=>setImmediate(resolve));h.render();
  assert.ok(h.find(n=>typeof n.props.children==='string'&&n.props.children.startsWith(label)));
  if(name==='unavailable')assert.ok(h.find(n=>n.type==='button'&&n.props.children==='Try again'));
 }finally{h.close();}
});
