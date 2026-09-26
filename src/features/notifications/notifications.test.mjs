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
 assert.equal(body.htmlbody,undefined);
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
