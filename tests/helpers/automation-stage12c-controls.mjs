/** Real Next HTTP environment/database kill-switch and activation-cutoff probe. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createServerClient} from '@supabase/ssr';
import {local,service,sql,json,literal,ok} from './automation-stage12c-recovery-env.mjs';
import {definition,action,group} from '../fixtures/automation.mjs';

assert.equal(sql('select active from private.automation_processing_state'),'f');
const org=randomUUID(),email=`stage12c-controls-${org}@example.invalid`,password=randomBytes(32).toString('base64url');
const admin=ok(await service.auth.admin.createUser({email,password,email_confirm:true})).user.id;
const cookies=new Map();
const auth=createServerClient(local.API_URL,local.ANON_KEY,{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:rows=>{for(const row of rows)cookies.set(row.name,row.value);}}});
ok(await auth.auth.signInWithPassword({email,password}));
const cookie=()=>[...cookies].map(([name,value])=>`${name}=${value}`).join('; ');
const identity=`set local role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify({sub:admin,role:'authenticated',aal:'aal1'}))},true);`;
sql(`insert into public.organizations(id,name,slug)values('${org}','Stage12C controls','controls-${org}');insert into public.organization_memberships(organization_id,user_id,role)values('${org}','${admin}','administrator');`);
const draft=definition({conditions:group(),actions:[action('add_internal_note',{body:'Synthetic control receipt'})]});
sql(`begin;${identity}do $$declare r public.automation_rules;begin r:=public.create_automation_rule('${org}',${json(draft)});perform public.set_automation_rule_enabled('${org}',r.id,1,true);end $$;commit;`);
const ticket=()=>sql(`begin;${identity}insert into public.tickets(organization_id,requester_id,title,description)values('${org}','${admin}','Synthetic switch ticket','Synthetic')returning id;commit;`).split('\n').at(-1);
const snapshot=()=>sql(`select jsonb_build_object('rules',(select jsonb_agg(to_jsonb(r)order by id)from public.automation_rules r where organization_id='${org}'),'versions',(select jsonb_agg(to_jsonb(v)order by version)from public.automation_rule_versions v where organization_id='${org}'),'events',(select jsonb_agg(to_jsonb(e)order by id)from private.domain_events e where organization_id='${org}'),'deliveries',(select jsonb_agg(to_jsonb(d)order by id)from private.domain_event_deliveries d where organization_id='${org}'),'executions',(select jsonb_agg(to_jsonb(x)order by id)from public.automation_executions x where organization_id='${org}'),'messages',(select jsonb_agg(to_jsonb(m)order by id)from public.ticket_messages m where organization_id='${org}'))`);
let server;
async function stop(){if(!server)return;const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await exited;server=null;}
async function start(mode){
  const file=openSync('/tmp/fixxflow-stage12c-controls-server.private','a',0o600);
  server=spawn(process.execPath,['tests/helpers/automation-stage12c-recovery-app.mjs',mode],{stdio:['ignore',file,file]});closeSync(file);
  for(let i=0;i<100;i++){
    if(server.exitCode!==null)throw new Error('Local recovery application exited');
    try {if((await fetch('http://127.0.0.1:3102/api/cron/automation')).status===401)return;}catch{}
    await delay(200);
  }
  throw new Error('Local recovery application did not start');
}
async function cron(kind){
  const secret=readFileSync('/tmp/fixxflow-stage12c-recovery-cron.private','utf8');
  const response=await fetch(`http://localhost:3102/api/cron/${kind}`,{headers:{authorization:`Bearer ${secret}`}});
  assert.equal(response.status,200);return response.json();
}
async function administration(){
  const response=await fetch('http://localhost:3102/app/administration/automations',{headers:{cookie:cookie()},redirect:'manual'});
  assert.equal(response.status,200);const body=await response.text();assert.doesNotMatch(body,/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_REDIRECT/);
}
const report={engine:sql('show server_version'),scope:'Separate production-mode Next HTTP server and Docker recovery database; real SSR cookie session',startedAt:new Date().toISOString()};
try {
  sql('select private.set_automation_processing(true)');const older=ticket();
  await start('off');const before=snapshot();
  assert.equal((await cron('automation')).disabled,true);assert.equal((await cron('automation-scheduler')).disabled,true);
  await administration();assert.equal(snapshot(),before);report.environmentOffPreservesPendingWork='PASS';
  await stop();sql('select private.set_automation_processing(false)');await start('controlled-test');
  const beforeDatabaseOff=snapshot();
  assert.equal((await cron('automation')).claimed,0);assert.equal((await cron('automation-scheduler')).disabled,true);
  await administration();assert.equal(snapshot(),beforeDatabaseOff);report.databaseOffPreservesPendingWorkAndAdmin='PASS';
  sql('select private.set_automation_processing(true)');await cron('automation');
  assert.equal(sql(`select count(*)from public.automation_executions where organization_id='${org}'and entity_id='${older}'`),'0');
  assert.equal(sql(`select count(*)from private.domain_event_deliveries d join private.domain_events e on e.id=d.event_id where e.organization_id='${org}'and e.entity_id='${older}'and d.status='pending'`),'1');
  report.oldUnadmittedWorkPreservedUnderActivationCutoff='PASS';
  const current=ticket();report.recoveryBatches=[];
  for(let i=0;i<10;i++){
    report.recoveryBatches.push(await cron('automation'));
    if(sql(`select count(*)from public.automation_executions where organization_id='${org}'and entity_id='${current}'and status='succeeded'`)==='1')break;
  }
  assert.equal(sql(`select count(*)from public.ticket_messages where organization_id='${org}'`),'1');
  report.newGenerationWorkExecutesOnce='PASS';report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.message;throw error;}
finally {
  sql('select private.set_automation_processing(false)');
  report.processing=sql('select active from private.automation_processing_state')==='f'?'OFF':'UNEXPECTED';
  await stop();report.server='stopped';report.finishedAt=new Date().toISOString();
  writeFileSync('/tmp/fixxflow-stage12c-controls-results.json',JSON.stringify(report,null,2));
}
console.log('PASS HTTP environment/database OFF controls, Administration, durable pending work and reactivation cutoffs');
