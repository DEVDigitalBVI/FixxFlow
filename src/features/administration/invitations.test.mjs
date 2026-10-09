import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';
const token='90000000-0000-4000-8000-000000000001';
function setup({role='administrator',prepared={data:{id:token,userId:null,completed:false},error:null},sendError=null,completeError=null}={}){
 const calls=[];
 const {inviteMember}=load('src/app/app/people/actions.ts',{
  'next/cache':{revalidatePath:path=>calls.push(['revalidate',path])},'next/navigation':{redirect:()=>assert.fail('Must preserve the form')},
  '@/lib/auth/viewer':{requireViewer:async()=>({id:'verified-admin',organizationId:'trusted-org',role})},
  '@/lib/supabase/admin':{createAdminClient:()=>({
   rpc:async(name,args)=>{calls.push([name,args]);return name==='prepare_member_invitation'?prepared:{error:completeError};},
   auth:{admin:{inviteUserByEmail:async(email)=>{calls.push(['send',email]);return {data:{user:sendError?null:{id:'invited-user'}},error:sendError};}}},
  })},
 });
 const data=new FormData();for(const [key,value]of Object.entries({submissionKey:token,email:' New@Example.Invalid ',displayName:'Pilot Employee',role:'end_user',actor:'spoofed'}))data.set(key,value);
 return {calls,data,submit:()=>inviteMember(data)};
}
test('invitation registration failures retain drafts and retry repairs without sending a second email',async()=>{
 const first=setup({completeError:{message:'sensitive database details'}});
 assert.match((await first.submit()).error,/workspace access needs repair/);assert.equal(first.calls.filter(c=>c[0]==='send').length,1);
 const retry=setup({prepared:{data:{id:token,userId:'invited-user',completed:false},error:null}});
 assert.match((await retry.submit()).success,/access repaired/);assert.equal(retry.calls.filter(c=>c[0]==='send').length,0);
 const args=retry.calls.find(c=>c[0]==='complete_member_invitation')[1];assert.equal(args.actor,'verified-admin');assert.equal(args.org,'trusted-org');assert.equal(args.invited_user,'invited-user');
});
test('invalid, busy, completed and uncertain invitation attempts never send unexpected emails',async()=>{
 for(const options of [{role:'technician'},{prepared:{data:null,error:{code:'PT429'}}},{prepared:{data:null,error:{code:'PT409'}}},{prepared:{data:{id:token,userId:'invited-user',completed:true},error:null}}]){
  const a=setup(options);const result=await a.submit();assert.ok(result.error||result.success);assert.equal(a.calls.filter(c=>c[0]==='send').length,0);
 }
 const invalid=setup();invalid.data.set('submissionKey','invalid');assert.ok((await invalid.submit()).error);assert.equal(invalid.calls.length,0);
 const uncertain=setup({sendError:{message:'secret'}});assert.match((await uncertain.submit()).error,/could not confirm/);assert.equal(uncertain.calls.some(c=>c[0]==='complete_member_invitation'),false);
});
