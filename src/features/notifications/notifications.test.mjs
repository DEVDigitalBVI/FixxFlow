import { load } from '../../../tests/helpers/load-module.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const {sendNotificationEmail} = load('src/features/notifications/email.ts');
const item = {notification_id:'notice-1',recipient_email:'recipient@example.test',title:'Ticket #1 resolved',ticket_id:'ticket-1',conversation_id:null};
const config = {apiKey:'mock-key',from:'FixxFlow <support@example.test>',siteUrl:'https://example.test'};
const {renderEmail} = load('src/features/notifications/template.ts');

test('security guidance is distinguished by a written heading and preserves escaped content',()=>{
 const html=renderEmail({title:'Password changed',message:'Your password changed.',purpose:'security-alert',note:'Contact support <script>alert(1)</script> & reset your password.'});
 assert.match(html,/Account security/);
 assert.match(html,/<h2[^>]*>Security notice<\/h2>/);
 assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; reset/);
 assert.doesNotMatch(html,/<script>/);
 const notification=renderEmail({title:'New reply',message:'Open your workspace.',note:'Sign in to view.'});
 assert.match(notification,/Workspace update/);
 assert.doesNotMatch(notification,/Security notice/);
});

test('generated email purposes keep invitations distinct from security changes',()=>{
 for(const file of ['confirm-sign-up','invite-user']) {
  const html=fs.readFileSync(`supabase/templates/${file}.html`,'utf8');
  assert.match(html,/Your workspace/);
  assert.doesNotMatch(html,/Security notice/);
 }
 for(const file of ['reset-password','magic-link-or-otp','change-email-address','reauthentication']) {
  assert.match(fs.readFileSync(`supabase/templates/${file}.html`,'utf8'),/Account access/);
 }
 for(const file of ['password-changed','email-address-changed','phone-number-changed','sign-in-method-linked','sign-in-method-removed','mfa-method-added','mfa-method-removed']) {
  const html=fs.readFileSync(`supabase/templates/${file}.html`,'utf8');
  assert.match(html,/Account security/);
  assert.match(html,/<h2[^>]*>Security notice<\/h2>/);
 }
});

test('auth templates retain Supabase tokens and accessible email branding',()=>{
 for(const file of fs.readdirSync('supabase/templates').filter(name=>name.endsWith('.html'))){
  const html=fs.readFileSync(`supabase/templates/${file}`,'utf8');
  assert.match(html,/<html lang="en">/);
  assert.match(html,/alt="FixxFlow/);
  assert.match(html,/role="presentation"/);
  assert.match(html,/mailto:support@fixxflow.app/);
  assert.doesNotMatch(html,/<script|onerror=/i);
  if(['reset-password.html','confirm-sign-up.html','invite-user.html','magic-link-or-otp.html','change-email-address.html'].includes(file))assert.match(html,/href="\{\{ \.ConfirmationURL \}\}"/);
  if(file==='reauthentication.html')assert.match(html,/\{\{ \.Token \}\}/);
 }
});
test('Zoho receives a correlation reference and authenticated link without conversation content',async()=>{
 let sent;
 assert.equal(await sendNotificationEmail(item,config,async(url,options)=>{sent={url,...options};return Response.json({request_id:'provider-1',data:[{code:'EM_104'}]});}), 'provider-1');
 assert.equal(sent.url,'https://cpaas.zoho.com/v1.1/email');
 assert.equal(sent.headers.Authorization,'Zoho-enczapikey mock-key');
 const body=JSON.parse(sent.body);
 assert.deepEqual(body.to,[{email_address:{address:'recipient@example.test'}}]);
 assert.equal(body.client_reference,'notification/notice-1');
 assert.deepEqual(body.from,{address:'support@example.test',name:'FixxFlow'});
 assert.equal(body.track_clicks,false);
 assert.equal(body.track_opens,false);
 assert.match(body.textbody,/https:\/\/example.test\/app\/tickets\/ticket-1/);
 assert.match(body.htmlbody,/fixxflow-logo-primary.png/);
 assert.match(body.htmlbody,/View update/);
 assert.match(body.htmlbody,/font-family:Inter,ui-sans-serif,system-ui/);
});
test('HTML notification titles are escaped and plain text remains available',async()=>{
 await sendNotificationEmail({...item,title:'<img src=x onerror=alert(1)> & update'},config,async(_url,options)=>{
  const body=JSON.parse(options.body);
  assert.match(body.htmlbody,/&lt;img src=x onerror=alert\(1\)&gt; &amp; update/);
  assert.doesNotMatch(body.htmlbody,/<img src=x/);
  assert.match(body.textbody,/<img src=x/);
  return Response.json({request_id:'safe',data:[{code:'EM_104'}]});
 });
});
test('provider failures and missing IDs are not acknowledged as sent',async()=>{
 await assert.rejects(sendNotificationEmail(item,config,async()=>new Response('private error',{status:429})),/HTTP 429/);
 await assert.rejects(sendNotificationEmail(item,config,async()=>Response.json({})),/no delivery ID/);
 await assert.rejects(sendNotificationEmail(item,config,async()=>Response.json({request_id:'bad',data:[{code:'ERROR'}]})),/did not accept/);
 await assert.rejects(sendNotificationEmail(item,{...config,siteUrl:'http://unsafe.test'}),/Invalid/);
});
test('copied Zoho authorization values are not double-prefixed and invalid senders never send',async()=>{
 let calls=0;
 const request=async(_url,options)=>{
  calls++;
  assert.equal(options.headers.Authorization,'Zoho-enczapikey copied-key');
  return Response.json({request_id:'provider-2',data:[{code:'EM_104'}]});
 };
 await sendNotificationEmail(item,{...config,apiKey:'Zoho-enczapikey copied-key'},request);
 await assert.rejects(sendNotificationEmail(item,{...config,from:'invalid'},request),/Invalid notification sender/);
 await assert.rejects(sendNotificationEmail(item,{...config,from:'support@example.test\r\nBcc: private@example.test'},request),/Invalid notification sender/);
 assert.equal(calls,1);
});
test('cron fails closed when secret is missing or wrong without accessing the queue',async()=>{
 const before=process.env.CRON_SECRET;
 try {
  const {GET}=load('src/app/api/cron/notifications/route.ts',{'@/lib/supabase/admin':{createAdminClient(){throw Error('Must not access database');}},'@/features/notifications/email':{sendNotificationEmail}});
  delete process.env.CRON_SECRET;
  assert.equal((await GET(new Request('https://example.test'))).status,401);
  process.env.CRON_SECRET='test-secret';
  assert.equal((await GET(new Request('https://example.test',{headers:{authorization:'Bearer incorrect'}}))).status,401);
 } finally {if(before===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=before;}
});

test('network errors, timeouts and malformed provider responses never count as accepted delivery',async()=>{
 for (const failure of [new TypeError('fetch failed'), new DOMException('Request timed out','TimeoutError')]) {
  await assert.rejects(sendNotificationEmail(item,config,async(_url,options)=>{
   assert.ok(options.signal instanceof AbortSignal);
   throw failure;
  }),error=>error===failure);
 }
 await assert.rejects(sendNotificationEmail(item,config,async()=>new Response('not JSON',{status:200})),SyntaxError);
 for(const data of [null,[],[null],[{code:'EM_104'},{code:'EM_104'}],[{code:'EM_103'}]]) {
  await assert.rejects(sendNotificationEmail(item,config,async()=>Response.json({request_id:'unaccepted',data})),/did not accept/);
 }
});

test('chat and fallback email links retain the configured origin',async()=>{
 for(const [target,path] of [
  [{ticket_id:null,conversation_id:'chat/1'},'/app/chat/chat%2F1'],
  [{ticket_id:null,conversation_id:null},'/app/notifications'],
 ]) {
  await sendNotificationEmail({...item,...target},{...config,siteUrl:'https://example.test/ignored/path'},async(_url,options)=>{
   const body=JSON.parse(options.body);
   assert.ok(body.textbody.includes(`https://example.test${path}`));
   assert.ok(body.htmlbody.includes(`href="https://example.test${path}"`));
   assert.deepEqual(body.reply_to,[{address:'support@fixxflow.app',name:'FixxFlow Support'}]);
   return Response.json({request_id:'accepted',data:[{code:'EM_104'}]});
  });
 }
});
