import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
 const filename = path.resolve(file);
 const compiled = ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const m = {exports:{}};
 new Function('require','module','exports',compiled)(name => name in mocks ? mocks[name] : name.startsWith('.') ? load(path.resolve(path.dirname(filename),name+'.ts')) : require(name),m,m.exports);
 return m.exports;
}
const {sendNotificationEmail} = load('src/features/notifications/email.ts');
const item = {notification_id:'notice-1',recipient_email:'recipient@example.test',title:'Ticket #1 resolved',ticket_id:'ticket-1',conversation_id:null};
const config = {apiKey:'mock-key',from:'FixxFlow <support@example.test>',siteUrl:'https://example.test'};
test('Resend receives a stable idempotency key and authenticated link without conversation content',async()=>{
 let sent;
 assert.equal(await sendNotificationEmail(item,config,async(url,options)=>{sent={url,...options};return Response.json({id:'provider-1'});}), 'provider-1');
 assert.equal(sent.headers['Idempotency-Key'],'notification/notice-1');
 const body=JSON.parse(sent.body);
 assert.deepEqual(body.to,['recipient@example.test']);
 assert.match(body.text,/https:\/\/example.test\/app\/tickets\/ticket-1/);
 assert.equal(body.html,undefined);
});
test('provider failures and missing IDs are not acknowledged as sent',async()=>{
 await assert.rejects(sendNotificationEmail(item,config,async()=>new Response('private error',{status:429})),/HTTP 429/);
 await assert.rejects(sendNotificationEmail(item,config,async()=>Response.json({})),/no delivery ID/);
 await assert.rejects(sendNotificationEmail(item,{...config,siteUrl:'http://unsafe.test'}),/Invalid/);
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
