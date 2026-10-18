import assert from 'node:assert/strict';
import test from 'node:test';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
const message={id:'message',author_id:'viewer',kind:'message',body:'A typo',created_at:'2026-10-17T12:00:00Z',revision:1,edited_at:null};
function fixture(result){let saved,dirty,refreshes=0;const calls=[];
 const props={message,conversationId:'chat',organizationId:'org',canEdit:true,onSaved:row=>{saved=row;}};
 const h=componentHarness('src/features/chat/editable-message.tsx','EditableChatMessage',props,{
  '@/lib/supabase/client':{createClient:()=>({rpc:async(...args)=>{calls.push(args);return typeof result==='function'?result():result;}})},
  'next/navigation':{useRouter:()=>({refresh(){refreshes++;}})},
  '@/components/ui/unsaved-changes':{useUnsavedChanges:value=>{dirty=value;}},
 });
 return{h,props,calls,saved:()=>saved,dirty:()=>dirty,refreshes:()=>refreshes,begin(){h.find(n=>n.type==='button').props.onClick();h.render();},change(body){h.find(n=>n.type==='textarea').props.onChange({target:{value:body}});h.render();},submit(){return h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});}};
}

test('editing saves only the captured revision, exposes metadata and restores focus',async()=>{
 const updated={...message,body:'A correction',revision:2,edited_at:'2026-10-17T12:01:00Z'};
 const f=fixture({data:[updated],error:null});try{
  f.begin();assert.equal(f.h.focuses.at(-1),'edit-message');f.change('A correction');assert.equal(f.dirty(),true);
  await f.submit();f.h.render();assert.deepEqual(f.calls,[['edit_chat_message',{org:'org',conversation:'chat',message:'message',expected_revision:1,new_body:'A correction'}]]);
  assert.deepEqual(f.saved(),updated);assert.equal(f.dirty(),false);assert.match(f.h.focuses.at(-1),/Edit your message/);
  assert.ok(f.h.all(n=>n.type==='small').length);
 }finally{f.h.close();}
});

test('failed and conflicting edits keep the draft and never overwrite refreshed messages',async()=>{
 for(const result of [{data:null,error:Error('offline')},{data:[],error:null}]){
  const f=fixture(result);try{f.begin();f.change('Keep this correction');f.props.message={...message,body:'Changed elsewhere',revision:2};f.h.render();
   await f.submit();f.h.render();assert.equal(f.h.find(n=>n.type==='textarea').props.value,'Keep this correction');assert.equal(f.calls[0][1].expected_revision,1);assert.equal(f.h.find(n=>n.props.role==='alert').props.tabIndex,-1);assert.equal(f.saved(),undefined);
   f.h.find(n=>n.type==='button'&&n.props.children==='Cancel editing').props.onClick();f.h.render();assert.equal(f.h.find(n=>n.type==='p').props.children,'Changed elsewhere');
  }finally{f.h.close();}
 }
});

test('pending saves reject duplicates; closed chats keep edits available to copy',async()=>{
 let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));try{
  f.begin();f.change('Corrected');const pending=f.submit();f.h.render();await f.submit();assert.equal(f.calls.length,1);
  finish({data:[],error:null});await pending;f.props.canEdit=false;f.h.render();assert.equal(f.h.find(n=>n.type==='textarea').props.value,'Corrected');
  assert.equal(f.h.find(n=>n.type==='button'&&n.props.children==='Save changes').props.disabled,true);
 }finally{f.h.close();}
});

test('older route props and out-of-order live edits cannot roll back message text',()=>{
 const {mergeChatMessages}=load('src/features/chat/message-model.ts');
 const newer={...message,body:'Latest',revision:3};assert.equal(mergeChatMessages([newer],[message])[0].body,'Latest');
 assert.equal(mergeChatMessages([newer],[{...message,revision:2}])[0].revision,3);
});
