/** Real local PostgREST regression using synthetic signed JWT fixtures.
 * This verifies HTTP/RLS/MFA-claim enforcement, NOT GoTrue login/TOTP or Next SSR.
 * Fixed disposable identities; no .env, hosted URL or existing volume is loaded.
 */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes,createHmac} from 'node:crypto';
import {readFile,readdir,writeFile,unlink} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import {load} from './load-module.mjs';
import {definition,group,action} from '../fixtures/automation.mjs';
const db='fixxflow-stage12-corrections-http-pg17',rest='fixxflow-stage12-corrections-postgrest',network='fixxflow-stage12-corrections-http';
const origin='http://127.0.0.1:54630',envFile='/tmp/fixxflow-stage12-corrections-postgrest.private';
const org='20000000-0000-0000-0000-000000000401',other='20000000-0000-0000-0000-000000000402',admin='10000000-0000-0000-0000-000000000401',otherAdmin='10000000-0000-0000-0000-000000000402',tech='10000000-0000-0000-0000-000000000403',employee='10000000-0000-0000-0000-000000000404';
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024,...options}).trim();
const q=sql=>docker(['exec','-i',db,'psql','-X','-qAt','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql});
const lit=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const auth=`set local role authenticated;do $$begin perform set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal2"}',true);end $$;`;
const key=randomBytes(40).toString('base64url');
const token=(sub,aal='aal2',role='authenticated')=>{const body=[{alg:'HS256',typ:'JWT'},{role,sub,aal,exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return body+'.'+createHmac('sha256',key).update(body).digest('base64url');};
const client=(sub,aal,role)=>createClient(origin,token(sub,aal,role),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch(input,init){const url=new URL(input);assert.equal(url.origin,origin);url.pathname=url.pathname.replace(/^\/rest\/v1/,'');return fetch(url,init);}}});
const ok=result=>{assert.equal(result.error,null,result.error?`HTTP database error ${result.error.code}`:undefined);return result.data;};
const report={scope:'Local PG17/PostgREST 16.4, signed synthetic JWT/MFA-factor fixtures; not Auth login or deployed application',checks:{}};
let databaseStarted=false,restStarted=false;
docker(['network','create','--internal',network]);
try{
 docker(['run','--name',db,'--rm','-d','--network',network,'--user','postgres','--entrypoint','/bin/sh','public.ecr.aws/supabase/postgres:17.11.0.002','-c',"initdb -D /tmp/http -A trust > /tmp/init.log && echo 'host all all 0.0.0.0/0 trust' >> /tmp/http/pg_hba.conf && exec postgres -D /tmp/http -c listen_addresses=* -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c cron.launch_active_jobs=off -c wal_level=logical"]);databaseStarted=true;
 let ready=false;for(let n=0;n<50;n++){try{q('select 1');ready=true;break;}catch{await delay(100);}}assert.equal(ready,true);report.postgres=q('show server_version');assert.match(report.postgres,/^17\./);
 q(await readFile('tests/fixtures/supabase-bootstrap.sql','utf8'));
 const legacy=[];const large=definition({conditions:group(),actions:Array.from({length:5},(_,n)=>action('add_internal_note',{body:'界'.repeat(18000)},n))});
 for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()){
  if(file.endsWith('_automation_guardrails.sql')){
   q(await readFile('tests/fixtures/domain-events.sql','utf8'));
   for(let n=0;n<2;n++){const r=JSON.parse(q(`begin;${auth}select row_to_json(r)from public.create_automation_rule('${org}',${lit(large)})r;commit;`));legacy.push(JSON.parse(q(`begin;${auth}select row_to_json(r)from public.set_automation_rule_enabled('${org}','${r.id}',1,true)r;commit;`)));}
  }
  q(await readFile(`supabase/migrations/${file}`,'utf8'));
 }
 q(`create role authenticator login noinherit;grant anon,authenticated,service_role to authenticator;insert into auth.mfa_factors(id,user_id,factor_type,status)values(gen_random_uuid(),'${admin}','totp','verified');`);
 await writeFile(envFile,`PGRST_DB_URI=postgresql://authenticator@${db}:5432/postgres\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${key}\nPGRST_LOG_LEVEL=info\n`,{mode:0o600});
 docker(['run','--name',rest,'--rm','-d','--network','bridge','-p','127.0.0.1:54630:3000','--env-file',envFile,'public.ecr.aws/supabase/postgrest:v16.4']);restStarted=true;docker(['network','connect',network,rest]);
 for(let n=0;n<100;n++){try{const r=await fetch(origin);report.readinessStatus=r.status;report.readinessBody=await r.text();if(r.ok){ready=true;break;}}catch(error){report.readinessError=error.cause?.code??error.name;}ready=false;await delay(100);}if(!ready){const diagnostic=spawnSync('docker',['logs','--tail','12',rest],{encoding:'utf8'});report.serverLog=diagnostic.stdout+diagnostic.stderr;report.containerState=docker(['inspect','--format','{{json .State}} {{json .NetworkSettings.Ports}}',rest]);}assert.equal(ready,true);delete report.readinessBody;delete report.readinessError;
 const a=client(admin),b=client(otherAdmin),service=client(null,'aal2','service_role');
 const {automationRepository}=load('src/features/automation/repository.ts',{'server-only':{}});
 const repository=automationRepository(a,org);assert.deepEqual((await repository.get(legacy[0].id)).rule.definition,large);assert.equal((await repository.versions(legacy[0].id,1)).length,2);report.checks.legacyRepositoryRead='PASS';
 let old=ok(await a.rpc('set_automation_rule_enabled',{target_organization_id:org,rule_id:legacy[0].id,expected_version:legacy[0].version,enabled:false}));
 assert.equal(old.enabled,false);
 assert.equal((await a.rpc('set_automation_rule_enabled',{target_organization_id:org,rule_id:old.id,expected_version:old.version,enabled:true})).error?.code,'FF004');
 old=ok(await a.rpc('archive_automation_rule',{target_organization_id:org,rule_id:old.id,expected_version:old.version}));assert.ok(old.archived_at);
 assert.equal((await a.rpc('create_automation_rule',{target_organization_id:org,definition:large})).error?.code,'FF004');report.checks.legacyLifecycleAndStrictWrite='PASS';
 const ticket=ok(await a.from('tickets').insert({organization_id:org,requester_id:employee,title:'HTTP dry run',description:'Synthetic'}).select('id').single());
 const snapshot=()=>q("select json_build_object('events',(select count(*)from private.domain_events),'deliveries',(select count(*)from private.domain_event_deliveries),'executions',(select count(*)from public.automation_executions),'steps',(select count(*)from public.automation_execution_steps),'capacity',(select count(*)from private.automation_capacity),'notifications',(select count(*)from public.notifications),'tickets',(select md5(string_agg(to_jsonb(t)::text,''order by id))from public.tickets t))");
 const draft=definition({conditions:group(),actions:[action('add_internal_note',{body:'Synthetic'})]}),before=snapshot();
 ok(await a.rpc('read_automation_dry_run',{target_organization_id:org,ticket_id:ticket.id,draft}));
 assert.equal((await a.rpc('read_automation_dry_run',{target_organization_id:org,ticket_id:ticket.id,rule_id:legacy[1].id,rule_version:legacy[1].version})).error?.code,'FF004');assert.equal(snapshot(),before);report.checks.dryRunStrictAndZeroSideEffects='PASS';
 for(const denied of [client(admin,'aal1'),client(tech),client(employee),b]){
  assert.equal(ok(await denied.from('automation_rules').select('id').eq('organization_id',org)).length,0);
  for(const [name,args] of [['create_automation_rule',{target_organization_id:org,definition:draft}],['read_automation_operations',{org}],['read_automation_operations_history',{org,result_filter:'guardrail'}],['read_automation_dry_run',{target_organization_id:org,ticket_id:ticket.id,draft}],['read_automation_admin',{org,kind:'references',resource:'teams'}]])assert.equal((await denied.rpc(name,args)).error?.code,'42501',name);
  assert.ok((await denied.rpc('claim_automation_events',{})).error);
 }
 assert.equal(ok(await a.from('automation_rules').select('id').eq('organization_id',other)).length,0);report.checks.tenantRoleMfaClaimBoundaries='PASS';
 ok(await a.rpc('archive_automation_rule',{target_organization_id:org,rule_id:legacy[1].id,expected_version:legacy[1].version}));
 // Real worker + HTTP mutation authority produces an actual safety outcome.
 q(`insert into auth.users(id,email)select ('90000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'fanout'||n||'@example.invalid'from generate_series(1,121)n;insert into public.organization_memberships(organization_id,user_id,role)select '${org}',id,'technician'from auth.users where id::text like '90000000-%';`);
 const fanout=ok(await a.rpc('create_automation_rule',{target_organization_id:org,definition:{...draft,actions:[action('set_status',{status:'open'})]}}));
 ok(await a.rpc('set_automation_rule_enabled',{target_organization_id:org,rule_id:fanout.id,expected_version:1,enabled:true}));
 q('select private.set_automation_processing(true)');
 try{
  ok(await a.from('tickets').insert({organization_id:org,requester_id:employee,title:'Fanout guard',description:'Synthetic',status:'resolved'}));
  const failures=load('src/features/automation/worker-failures.ts');const mocks={'server-only':{},'./worker-failures':failures};
  const {automationWorkerRepository}=load('src/features/automation/worker-repository.ts',mocks),{runAutomationWorker}=load('src/features/automation/worker.ts',mocks);
  await runAutomationWorker(automationWorkerRepository(service),{enabled:true});
  const view=ok(await a.rpc('read_automation_operations',{org}));assert.equal(view.executions.guardrailTerminated,1);assert.equal(view.executions.actionFailed,0);
  for(const [filter,count] of [['guardrail',1],['action_failed',0],['failures',1]])assert.equal(ok(await a.rpc('read_automation_operations_history',{org,result_filter:filter})).rows.length,count);
  report.checks.workerPostgrestGuardrailClassification='PASS';
 }finally{q('select private.set_automation_processing(false)');}
 assert.equal(q('select active from private.automation_processing_state'),'f');report.processing='OFF';report.result='PASS';
}finally{
 if(restStarted)docker(['stop',rest]);if(databaseStarted)docker(['stop',db]);docker(['network','rm',network]);await unlink(envFile).catch(()=>{});
 await writeFile('/tmp/fixxflow-stage12-corrections-postgrest.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify(report));
