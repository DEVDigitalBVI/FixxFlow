import { load } from '../../../tests/helpers/load-module.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const {sendNotificationEmail} = load('src/features/notifications/email.ts');
const item = {notification_id:'notice-1',recipient_email:'recipient@example.test',title:'Ticket #1 resolved',ticket_id:'ticket-1',conversation_id:null};
const config = {apiKey:'mock-key',from:'FixxFlow <support@example.test>',siteUrl:'https://example.test'};
const {renderEmail} = load('src/features/notifications/template.ts');

test('all email variants share the invitation layout and centered content',()=>{
 const emails=fs.readdirSync('supabase/templates').filter(name=>name.endsWith('.html'))
  .map(file=>[file,fs.readFileSync(`supabase/templates/${file}`,'utf8')]);
 for(const purpose of ['notification','workspace','account-access','security-alert']) {
  emails.push([purpose,renderEmail({title:'Workspace update',message:'Your update is ready.',purpose,action:'View update',href:'https://example.test/update',note:'Contact support for help.'})]);
 }
 for(const [name,html] of emails) {
  assert.match(html,/<td align="center" style="padding:24px;text-align:center;overflow-wrap:anywhere">/,name);
  assert.match(html,/<p style="margin:0 0 8px;color:#64748b;font-size:14px;line-height:22px;font-weight:500">/,name);
  assert.match(html,/<p style="max-width:420px;margin:0 auto 20px;color:#64748b;">/,name);
  assert.match(html,/<td align="center" style="text-align:center;padding:16px 24px;border-top:/,name);
  assert.match(html,/width="100%"[^>]*style="max-width:560px/,name);
  if(html.includes('Button not working?')) {
   assert.match(html,/<table role="presentation" align="center" style="margin:0 auto"/,name);
   assert.match(html,/word-break:break-all;overflow-wrap:anywhere/,name);
  }
  if(html.includes('Security notice')) assert.match(html,/<td align="center" bgcolor="#fff7e6" style="text-align:center;/,name);
 }
});

test('invitation overview has three semantic role lists before its primary action',()=>{
 const html=fs.readFileSync('supabase/templates/invite-user.html','utf8');
 assert.match(html,/What you can do in FixxFlow/);
 assert.match(html,/\{\{ \.Data.invited_by \}\}/);
 assert.match(html,/\{\{ \.Data.workspace_name \}\}/);
 const branches=html.match(/\{\{ if eq \.Data.invitation_role "administrator" \}\}([\s\S]*?)\{\{ else if eq \.Data.invitation_role "technician" \}\}([\s\S]*?)\{\{ else \}\}([\s\S]*?)\{\{ end \}\}/);
 assert.ok(branches,'Role branches include an employee fallback for missing metadata');
 for(const branch of branches.slice(1)) {
  assert.match(branch,/<ul[^>]*>/);
  assert.equal((branch.match(/<li /g)||[]).length,3);
  assert.doesNotMatch(branch,/<a /);
 }
 assert.match(branches[1],/manage workspace access/);
 assert.match(branches[2],/internal notes/);
 assert.match(branches[3],/Submit IT requests/);
 assert.ok(html.indexOf('What you can do')<html.indexOf('>Accept invitation</a>'));
 assert.doesNotMatch(fs.readFileSync('supabase/templates/reset-password.html','utf8'),/What you can do/);
});

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
  if(['reset-password.html','confirm-sign-up.html','magic-link-or-otp.html','change-email-address.html'].includes(file))assert.match(html,/href="\{\{ \.ConfirmationURL \}\}"/);
  if(file==='invite-user.html') {
   assert.match(html,/href="\{\{ \.SiteURL \}\}\/auth\/callback\?token_hash=\{\{ \.TokenHash \}\}&amp;type=invite"/);
   assert.doesNotMatch(html,/\.ConfirmationURL/);
  }
  if(file==='reauthentication.html')assert.match(html,/\{\{ \.Token \}\}/);
 }
});
test('Resend receives an idempotency key and authenticated link without conversation content',async()=>{
 let sent;
 assert.equal(await sendNotificationEmail(item,config,async(url,options)=>{sent={url,...options};return Response.json({id:'provider-1'});}), 'provider-1');
 assert.equal(sent.url,'https://api.resend.com/emails');
 assert.equal(sent.headers.Authorization,'Bearer mock-key');
 const body=JSON.parse(sent.body);
 assert.deepEqual(body.to,['recipient@example.test']);
 assert.equal(sent.headers['Idempotency-Key'],'notification/notice-1');
 assert.equal(body.from,'FixxFlow <support@example.test>');
 assert.equal(body.reply_to,'support@fixxflow.app');
 assert.deepEqual(Object.keys(body).sort(),['from','html','reply_to','subject','text','to']);
 assert.match(body.text,/https:\/\/example.test\/app\/tickets\/ticket-1/);
 assert.match(body.html,/fixxflow-logo-primary.png/);
 assert.match(body.html,/View update/);
 assert.match(body.html,/font-family:Inter,ui-sans-serif,system-ui/);
});
test('HTML notification titles are escaped and plain text remains available',async()=>{
 await sendNotificationEmail({...item,title:'<img src=x onerror=alert(1)> & update'},config,async(_url,options)=>{
  const body=JSON.parse(options.body);
  assert.match(body.html,/&lt;img src=x onerror=alert\(1\)&gt; &amp; update/);
  assert.doesNotMatch(body.html,/<img src=x/);
  assert.match(body.text,/<img src=x/);
  return Response.json({id:'safe'});
 });
});
test('provider failures and missing IDs are not acknowledged as sent',async()=>{
 await assert.rejects(sendNotificationEmail(item,config,async()=>new Response('private error',{status:429})),/HTTP 429/);
 await assert.rejects(sendNotificationEmail(item,config,async()=>Response.json({})),/no delivery ID/);
 for(const id of [undefined,null,42,'','   ']) await assert.rejects(sendNotificationEmail(item,config,async()=>Response.json({id})),/no delivery ID/);
 await assert.rejects(sendNotificationEmail(item,config,async()=>Response.json({request_id:'legacy',data:[{code:'EM_104'}]})),/no delivery ID/);
 await assert.rejects(sendNotificationEmail(item,{...config,siteUrl:'http://unsafe.test'}),/Invalid/);
});
test('Resend uses bearer authentication and invalid senders never send',async()=>{
 let calls=0;
 const request=async(_url,options)=>{
  calls++;
  assert.equal(options.headers.Authorization,'Bearer copied-key');
  return Response.json({id:'provider-2'});
 };
 await sendNotificationEmail(item,{...config,apiKey:'copied-key'},request);
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
 for(const result of [null,[],{name:'validation_error',message:'private details'}]) {
  await assert.rejects(sendNotificationEmail(item,config,async()=>Response.json(result)),/no delivery ID/);
 }
});

test('chat and fallback email links retain the configured origin',async()=>{
 for(const [target,path] of [
  [{ticket_id:null,conversation_id:'chat/1'},'/app/chat/chat%2F1'],
  [{ticket_id:null,conversation_id:null},'/app/notifications'],
 ]) {
  await sendNotificationEmail({...item,...target},{...config,siteUrl:'https://example.test/ignored/path'},async(_url,options)=>{
   const body=JSON.parse(options.body);
   assert.ok(body.text.includes(`https://example.test${path}`));
   assert.ok(body.html.includes(`href="https://example.test${path}"`));
   assert.equal(body.reply_to,'support@fixxflow.app');
   return Response.json({id:'accepted'});
  });
 }
});


test('ambiguous failures reuse the same idempotency key and payload across queue leases',async()=>{
 const attempts=[];
 const request=async(_url,options)=>{
  attempts.push({key:options.headers['Idempotency-Key'],body:options.body});
  if(attempts.length===1) throw new TypeError('response lost after acceptance');
  return Response.json({id:'accepted-once'});
 };
 await assert.rejects(sendNotificationEmail({...item,lease_token:'first'},config,request),/response lost/);
 assert.equal(await sendNotificationEmail({...item,lease_token:'retry'},config,request),'accepted-once');
 assert.deepEqual(attempts[0],attempts[1]);
 await sendNotificationEmail({...item,notification_id:'notice-2'},config,request);
 assert.notEqual(attempts[1].key,attempts[2].key);
});
