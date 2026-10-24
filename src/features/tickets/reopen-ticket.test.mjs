import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {componentHarness} from '../../../tests/helpers/component-harness.mjs';
import {load} from '../../../tests/helpers/load-module.mjs';
const id='10000000-0000-4000-8000-000000000001';

test('employee reopen form has a native disclosure, required explanation and stable retry identity',async()=>{
 const calls=[];const props={ticketId:id,revision:3,action:async data=>{calls.push(Object.fromEntries(data));return {error:'Try again'};}};
 const h=componentHarness('src/features/tickets/reopen-ticket-form.tsx','ReopenTicketForm',props);
 try{
  assert.equal(h.find(n=>n.type==='summary').props.children,'Reopen ticket');
  assert.equal(h.find(n=>n.type==='textarea').props.required,true);
  h.find(n=>n.type==='textarea').props.onChange({target:{value:'It still does not print.'}});h.render();
  const submit=async()=>{const data=new FormData();for(const input of h.all(n=>n.type==='input'))data.set(input.props.name,String(input.props.value));data.set('reason',h.find(n=>n.type==='textarea').props.value);return h.find(n=>n.props.action).props.action(data);};
  await submit();await submit();
  assert.equal(calls[0].requestToken,calls[1].requestToken);
  assert.equal(h.find(n=>n.type==='textarea').props.value,'It still does not print.');
  props.revision=4;h.render();assert.equal(h.find(n=>n.props.name==='revision').props.value,3);
  h.find(n=>n.type==='textarea').props.onChange({target:{value:'The issue returned.'}});h.render();await submit();
  assert.notEqual(calls[2].requestToken,calls[0].requestToken);
 }finally{h.close();}
});

test('reopen server action validates reason and returns recoverable errors instead of losing the draft',async()=>{
 const calls=[];let error=null;
 const {reopenTicket}=load('src/app/app/tickets/actions.ts',{
  'next/cache':{revalidatePath(){}},'@/lib/auth/viewer':{requireViewer:async()=>({id,organizationId:'trusted-org',role:'end_user'})},
  '@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:2,error};}})},
  '@/lib/server-errors':{reportServerError(){}},
 });
 const form=()=>new Map(Object.entries({ticketId:id,revision:'1',requestToken:id,reason:'The same issue is still happening.'}));
 const blank=form();blank.set('reason',' ');assert.ok((await reopenTicket(blank)).fieldErrors.reason);assert.equal(calls.length,0);
 error={code:'PT409'};assert.match((await reopenTicket(form())).error,/changed/);
 error={code:'08006'};assert.match((await reopenTicket(form())).error,/preserved/);
 error=null;assert.match((await reopenTicket(form())).redirectTo,/success=/);
 assert.equal(calls.at(-1).name,'reopen_ticket');assert.equal(calls.at(-1).args.expected_revision,1);
});

test('closed employee ticket exposes Reopen ticket before its request and conversation',async()=>{
 let status='closed';
 const db={from(table){const response=()=>({data:table==='tickets'?{id,requester_id:'employee',status,revision:2,ticket_number:1007,title:'Printer',description:'Help',request_kind:'support'}:[],error:null});const q=new Proxy({},{get:(_,key)=>key==='then'?resolve=>Promise.resolve(response()).then(resolve):()=>q});return q;}};
 const {TicketDetail}=load('src/features/tickets/ticket-detail.tsx',{
  '@/lib/auth/viewer':{requireViewer:async()=>({id:'employee',organizationId:'org',role:'end_user'})},'@/lib/supabase/server':{createClient:async()=>db},
  '@/features/lookups/labels':{profileLabels:async()=>[]},'./reopen-ticket-form':{ReopenTicketForm:()=>React.createElement('div',null,'Reopen ticket')},
  '@/features/chat/linked-chat-history':{LinkedChatHistory:()=>null},'@/features/tickets/attachment-upload':{AttachmentUpload:()=>null},
  '@/features/tickets/conversation-refresh':{ConversationRefresh:()=>null},'./reported-impact':{ReportedImpact:()=>null},
  '@/features/inventory/request-panel':{InventoryRequestPanel:()=>null},'@/features/tickets/message-composer':{MessageComposer:()=>null},
 });
 for(const state of ['resolved','closed']){status=state;const html=renderToStaticMarkup(await TicketDetail({ticketId:id}));assert.ok(html.indexOf('Reopen ticket')<html.indexOf('Your request'));assert.ok(html.indexOf('Reopen ticket')<html.indexOf('<h2>Conversation'));
 }
 status='open';assert.doesNotMatch(renderToStaticMarkup(await TicketDetail({ticketId:id})),/Reopen ticket/);
});
