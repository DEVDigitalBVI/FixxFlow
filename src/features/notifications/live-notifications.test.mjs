import assert from 'node:assert/strict';
import test from 'node:test';
import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('notification badges refresh on live changes and reconnect with recipient-scoped queries',async()=>{
 let count=3;const requests=[],listeners=[];let removes=0;
 const channel={on(type,filter,callback){listeners.push({type,filter,callback});return this;},subscribe(callback){callback('SUBSCRIBED');}};
 const query=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>Promise.resolve({count,error:null}).then(resolve):(...args)=>{requests.push([key,...args]);return query;}});
 const client={from:table=>{requests.push(['from',table]);return query;},realtime:{setAuth:async()=>{}},channel:name=>{requests.push(['channel',name]);return channel;},removeChannel(){removes++;}};
 const h=componentHarness('src/features/notifications/notification-link.tsx','NotificationLink',{organizationId:'org',userId:'viewer'},{'@/lib/supabase/client':{createClient:()=>client},'next/navigation':{usePathname:()=>'/app/chat'}});
 window.setTimeout=setTimeout;window.clearTimeout=clearTimeout;window.setInterval=setInterval;window.clearInterval=clearInterval;document.visibilityState='visible';
 try {
  await tick();h.render();await tick();
  assert.equal(h.find(n=>n.props.href==='/app/notifications').props['aria-label'],'Notifications, 3 unread');
  const event=listeners.at(-1);assert.deepEqual(event.filter,{event:'*',schema:'public',table:'notifications',filter:'recipient_id=eq.viewer'});
  count=0;event.callback();await tick();h.render();assert.equal(h.find(n=>n.props.href==='/app/notifications').props['aria-label'],'Notifications');
  for(const call of [['eq','organization_id','org'],['eq','recipient_id','viewer'],['is','read_at',null]])assert.ok(requests.some(row=>JSON.stringify(row)===JSON.stringify(call)));
 }finally{h.close();assert.ok(removes>0);}
});

test('chat notifications navigate to their conversation even when a linked ticket is present',()=>{
 const {notificationHref}=load('src/features/notifications/presentation.ts');
 assert.equal(notificationHref({conversation_id:'chat/one',ticket_id:'ticket'}),'/app/chat/chat%2Fone');
 assert.equal(notificationHref({conversation_id:null,ticket_id:'ticket'}),'/app/tickets/ticket');
});
