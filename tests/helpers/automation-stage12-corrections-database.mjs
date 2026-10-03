/** Fresh, network-isolated PG17 migration/locking/restore checks. Synthetic only.
 * Does not accept connection URLs or credentials. Never reads the prepared backup.
 */
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {definition,group,action} from '../fixtures/automation.mjs';
const mode=process.argv[2];assert.ok(['clean','upgrade','restore','advisors','concurrency','plans','restore-provenance'].includes(mode));
const container=`fixxflow-stage12-corrections-${mode}-pg17`;
const image='public.ecr.aws/supabase/postgres:17.11.0.002';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024}).trim();
function query(sql,name='observer'){
 const child=spawn('docker',['exec','-i','-e',`PGAPPNAME=correction-${name}`,container,'psql','-X','-qAt','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{stdio:['pipe','pipe','pipe']});
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');let output='',error='',ready;
 const locked=new Promise(resolve=>{ready=resolve;});
 child.stdout.on('data',v=>{output+=v;if(output.includes('LOCKED'))ready();});child.stderr.on('data',v=>{error+=v;});
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{if(code===0)resolve(output.trim());else{const e=new Error(`SQL failure ${/ERROR:\s+([A-Z0-9]{5})/.exec(error)?.[1]??'unknown'}`);e.code=/ERROR:\s+([A-Z0-9]{5})/.exec(error)?.[1];reject(e);}});});child.stdin.end(sql);return{done,locked};
}
const q=sql=>query(sql).done;
async function restoreLogical(target,dump){
 const sql=input=>execFileSync('docker',['exec','-i',target,'psql','-X','-qAt','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 const list=execFileSync('docker',['exec','-i',target,'pg_restore','--list'],{input:dump,encoding:'utf8',stdio:['pipe','pipe','pipe']});
 const lines=list.split('\n');const removed=lines.filter(line=>/ TABLE DATA private automation_version_visibility /.test(line));assert.equal(removed.length,1);
 execFileSync('docker',['exec','-i',target,'sh','-c','cat > /tmp/restore.list'],{input:lines.filter(line=>!removed.includes(line)).join('\n'),stdio:['pipe','pipe','pipe']});
 execFileSync('docker',['exec','-i',target,'pg_restore','-h','/tmp','-U','postgres','-d','postgres','--exit-on-error','--single-transaction','--use-list=/tmp/restore.list','--section=pre-data','--section=data'],{input:dump,stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024});
 sql(await readFile('docs/sql/automation-logical-restore-visibility.sql','utf8'));
 execFileSync('docker',['exec','-i',target,'pg_restore','-h','/tmp','-U','postgres','-d','postgres','--exit-on-error','--single-transaction','--section=post-data'],{input:dump,stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024});
 assert.equal(sql("select tgenabled from pg_trigger where tgrelid='private.automation_version_visibility'::regclass and tgname='automation_version_visibility_immutable'"),'O');
}

const json=async sql=>JSON.parse(await q(sql));
const report={mode,scope:'Disposable local Supabase PostgreSQL; test Auth/Storage substrate, no PostgREST or hosted services',acceptance:{migrationMs:300000,ordinaryMutationP95Ms:1000,ordinaryMutationMaxMs:2000},startedAt:new Date().toISOString()};
// Docker refuses an existing name; no existing cluster/volume is reset.
const network=mode==='advisors'?['--network','bridge','-p','127.0.0.1:54629:5432']:['--network','none'];
const startup=mode==='advisors'?"initdb -D /tmp/corrections -A trust > /tmp/init.log && echo 'host all all 0.0.0.0/0 trust' >> /tmp/corrections/pg_hba.conf && exec postgres -D /tmp/corrections -c listen_addresses=*":'initdb -D /tmp/corrections -A trust > /tmp/init.log && exec postgres -D /tmp/corrections -c listen_addresses=';
docker('run','--name',container,'--rm','-d',...network,'--user','postgres','--entrypoint','/bin/sh',image,'-c',startup+' -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c cron.launch_active_jobs=off -c wal_level=logical');
let ready=false;
for(let n=0;n<50;n++){try{await q('select 1');ready=true;break;}catch{await delay(100);}}assert.equal(ready,true);
try{
 report.engine=await q('show server_version');assert.match(report.engine,/^17\./);
 if(mode==='restore'){
  const source='fixxflow-stage12-corrections-pg17';
  assert.equal(docker('exec',source,'psql','-X','-qAt','-h','/tmp','-U','postgres','-d','postgres','-c','select active from private.automation_processing_state'),'f','Only back up after workload processing is OFF');
  const digest="select json_build_object('rules',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id))from public.automation_rules t),'versions',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by rule_id,version))from public.automation_rule_versions t),'executions',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id))from public.automation_executions t),'steps',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id))from public.automation_execution_steps t),'events',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id))from private.domain_events t),'deliveries',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id))from private.domain_event_deliveries t),'processing',(select to_jsonb(t)from private.automation_processing_state t))";
  report.before=JSON.parse(docker('exec',source,'psql','-X','-qAt','-h','/tmp','-U','postgres','-d','postgres','-c',digest));
  const dump=execFileSync('docker',['exec',source,'pg_dump','-h','/tmp','-U','postgres','-Fc','postgres'],{maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']});
  await writeFile('/tmp/fixxflow-stage12-corrections-synthetic.dump',dump,{mode:0o600});report.backupBytes=dump.length;
  await q('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;');
  const started=performance.now();await restoreLogical(container,dump);report.restoreMs=performance.now()-started;
  report.after=await json(digest);assert.deepEqual(report.after,report.before);
  report.oversizedRules=Number(await q('select count(*) from public.automation_rules where private.automation_definition_bytes(definition)>262144'));assert.ok(report.oversizedRules>=2);
  report.validatedCheck=await q("select convalidated from pg_constraint where conname='automation_rules_definition_check'");assert.equal(report.validatedCheck,'t');report.preservation='PASS';
 }else{
  await q(await readFile('tests/fixtures/supabase-bootstrap.sql','utf8'));
  const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();report.migrations=files.length;report.timings=[];
  const org='20000000-0000-0000-0000-000000000401',admin='10000000-0000-0000-0000-000000000401';
  const auth=`set local role authenticated;do $$begin perform set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal1"}',true);end $$;`;
  const lit=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
  const snapshot=()=>json("select json_build_object('rules',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by id))from public.automation_rules t),'versions',(select md5(string_agg(md5(to_jsonb(t)::text),'' order by rule_id,version))from public.automation_rule_versions t),'processing',(select to_jsonb(t)from private.automation_processing_state t))");
  let before;
  for(const file of files){
   if(mode==='upgrade'&&file.endsWith('_automation_guardrails.sql')){
    await q(await readFile('tests/fixtures/domain-events.sql','utf8'));
    const draft=definition({conditions:group(),actions:[action('add_internal_note',{body:'Synthetic '.repeat(600)})]});
    const legacy=definition({conditions:group(),actions:Array.from({length:5},(_,n)=>action('add_internal_note',{body:'界'.repeat(18000)},n))});
    await q(`begin;${auth}do $$declare r public.automation_rules;begin for i in 1..4000 loop r:=public.create_automation_rule('${org}',case when i<=2 then ${lit(legacy)} else ${lit(draft)} end);if i<=101 then perform public.set_automation_rule_enabled('${org}',r.id,1,true);end if;end loop;end $$;commit;`);
    before=await snapshot();report.rules=4000;report.legacyEnabled=101;
   }
   const migration=await readFile(`supabase/migrations/${file}`,'utf8');
   if(mode==='upgrade'&&file.endsWith('_automation_guardrails_corrections.sql')){
    const reader=query("begin;lock table public.automation_rules in access share mode;select 'LOCKED';select pg_sleep(1);commit;",'reader');await reader.locked;
    const blocked=query(`set lock_timeout='300ms';${migration}`,'blocked-migration');
    const blocking=blocked.done.then(()=>({code:null}),error=>({code:error.code}));await delay(100);
    report.waits=await json("select coalesce(json_agg(json_build_object('waitType',wait_event_type,'blockedBy',cardinality(pg_blocking_pids(pid)))),'[]') from pg_stat_activity where application_name='correction-blocked-migration'");
    assert.equal((await blocking).code,'55P03');await reader.done;
    assert.equal(await q("select to_regprocedure('private.validate_automation_stored_definition(jsonb)') is null"),'t');report.lockTimeoutRollback='PASS';assert.ok(report.waits.some(w=>w.waitType==='Lock'&&w.blockedBy>0));
    let finished=false;const started=performance.now();const migrate=query(migration,'migration').done.finally(()=>{finished=true;});report.mutationMs=[];
    do{
     const now=performance.now();await q(`begin;set local statement_timeout='5s';${auth}insert into public.tickets(organization_id,requester_id,title,description)values('${org}','${admin}','Migration concurrent ticket','Synthetic');commit;`);report.mutationMs.push(performance.now()-now);if(!finished)await delay(50);
    }while(!finished);
    await migrate;report.correctionMigrationMs=performance.now()-started;
    report.timings.push({file,ms:report.correctionMigrationMs});
   }else{const started=performance.now();await q(migration);report.timings.push({file,ms:performance.now()-started});}
  }
  if(mode==='upgrade'){
   assert.deepEqual(await snapshot(),before);report.preservation='PASS';assert.equal(await q('select count(*) from public.automation_rules where enabled'),'101');
   const disabled=await q("select id from public.automation_rules where not enabled limit 1");
   await assert.rejects(q(`begin;${auth}select public.set_automation_rule_enabled('${org}','${disabled}',1,true);commit;`),{code:'FF001'});report.furtherEnableDenied='PASS';
   const sorted=report.mutationMs.toSorted((a,b)=>a-b);report.mutationLatency={count:sorted.length,p95Ms:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],maxMs:sorted.at(-1)};
   report.impactTarget=report.correctionMigrationMs<report.acceptance.migrationMs&&report.mutationLatency.p95Ms<report.acceptance.ordinaryMutationP95Ms&&report.mutationLatency.maxMs<report.acceptance.ordinaryMutationMaxMs?'PASS':'FAIL';
  }
  report.security=await json("select json_build_object('helperExposed',has_function_privilege('anon','private.validate_automation_stored_definition(jsonb)','execute') or has_function_privilege('authenticated','private.validate_automation_stored_definition(jsonb)','execute') or has_function_privilege('service_role','private.validate_automation_stored_definition(jsonb)','execute'),'ruleRls',(select relrowsecurity from pg_class where oid='public.automation_rules'::regclass),'capacityRls',(select relrowsecurity from pg_class where oid='private.automation_capacity'::regclass),'capacityMutation',has_table_privilege('authenticated','private.automation_capacity','update'))");
  assert.deepEqual(report.security,{helperExposed:false,ruleRls:true,capacityRls:true,capacityMutation:false});
  if(mode==='advisors'){
   const cli='/Users/devdigitalbvi/.npm/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-darwin-arm64/bin/supabase';
   try{report.advisors=execFileSync(cli,['db','advisors','--db-url','postgresql://postgres@127.0.0.1:54629/postgres?sslmode=disable','--type','all','--level','warn','--fail-on','error','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:16*1024*1024});report.advisorExit=0;}
   catch(error){report.advisorExit=error.status;report.advisors=error.stdout?.toString();report.advisorError=error.stderr?.toString();}
  }
  if(mode==='restore-provenance'){
   await q(await readFile('tests/fixtures/domain-events.sql','utf8'));
   const draft=definition({conditions:group(),actions:[action('add_internal_note',{body:'Restore canary'})]});
   const rule=await q(`begin;${auth}select id from public.create_automation_rule('${org}',${lit(draft)});commit;`);
   await q(`begin;${auth}select public.set_automation_rule_enabled('${org}','${rule}',1,true);commit;select private.set_automation_processing(true);begin;${auth}insert into public.tickets(organization_id,requester_id,title,description)values('${org}','${admin}','Source pending','Synthetic');commit;select private.set_automation_processing(false);`);
   const versions=await q("select md5(string_agg(to_jsonb(t)::text,''order by rule_id,version))from public.automation_rule_versions t");
   const dump=execFileSync('docker',['exec',container,'pg_dump','-h','/tmp','-U','postgres','-Fc','postgres'],{maxBuffer:64*1024*1024,stdio:['pipe','pipe','pipe']});
   for(const repaired of [false,true]){
    const target=`fixxflow-stage12-corrections-provenance-${repaired?'recovered':'original'}`;
    const targetSql=sql=>execFileSync('docker',['exec','-i',target,'psql','-X','-qAt','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
    docker('run','--name',target,'--rm','-d','--network','none','--user','postgres','--entrypoint','/bin/sh',image,'-c','initdb -D /tmp/provenance -A trust > /tmp/init.log && exec postgres -D /tmp/provenance -c listen_addresses= -c unix_socket_directories=/tmp -c shared_preload_libraries=pg_cron -c cron.database_name=postgres -c cron.launch_active_jobs=off -c wal_level=logical');
    try{
     let ready=false;for(let n=0;n<50;n++){try{targetSql('select 1');ready=true;break;}catch{await delay(100);}}assert.equal(ready,true);
     targetSql('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;');
     if(repaired)await restoreLogical(target,dump);
     else execFileSync('docker',['exec','-i',target,'pg_restore','-h','/tmp','-U','postgres','-d','postgres','--exit-on-error','--single-transaction'],{input:dump,stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024});
     assert.equal(targetSql('select active from private.automation_processing_state'),'f');
     if(!repaired){report.sourceXid=await q('select pg_current_xact_id()::text');report.targetXid=targetSql('select pg_current_xact_id()::text');}
     targetSql(`select private.set_automation_processing(true);begin;${auth}insert into public.tickets(organization_id,requester_id,title,description)values('${org}','${admin}','Fresh after restore','Synthetic');commit;`);
     const eligible=targetSql(`select private.automation_rule_eligible(e,r) from private.domain_events e cross join public.automation_rules r where r.id='${rule}' and e.event_type='ticket.created' order by e.occurred_at desc limit 1`);
     if(!repaired){report.originalFreshEligibility=eligible;assert.equal(eligible,'f');}
     else{
      assert.equal(eligible,'t');report.recoveredFreshEligibility='PASS';
      const leases=JSON.parse(targetSql('begin;set local role service_role;select json_agg(row_to_json(d))from public.claim_automation_events()d;commit;'));assert.equal(leases.length,1);report.oldPendingExcluded='PASS';
      const d=leases[0],execution=JSON.parse(targetSql(`begin;set local role service_role;select row_to_json(x)from public.begin_automation_execution('${d.delivery_id}','${d.lease_token}','${rule}',2)x;commit;`));
      const command=lit({organizationId:org,entityId:execution.entity_id,action:draft.actions[0]});
      for(let n=0;n<2;n++)targetSql(`begin;set local role service_role;select public.execute_automation_ticket_step('${execution.id}','${d.lease_token}',${command});commit;`);
      targetSql(`begin;set local role service_role;select public.finish_domain_event_delivery('${d.delivery_id}','${d.lease_token}','acknowledged',null);commit;`);
      assert.equal(targetSql('select count(*)from public.ticket_messages'),'1');report.freshActionAndDeduplication='PASS';
      assert.equal(targetSql("select md5(string_agg(to_jsonb(t)::text,''order by rule_id,version))from public.automation_rule_versions t"),versions);report.immutableVersionsPreserved='PASS';
      // The procedure refuses an installed schema; never disables its guards.
      assert.throws(()=>targetSql('update private.automation_version_visibility set created_transaction=pg_current_xact_id()'));
      report.immutabilityGuardRestored='PASS';
     }
    }finally{targetSql('select private.set_automation_processing(false)');assert.equal(targetSql('select active from private.automation_processing_state'),'f');docker('stop',target);}
   }
   report.targetProcessing='OFF';
  }
  if(mode==='plans'){
   await q(await readFile('tests/fixtures/domain-events.sql','utf8'));
   const other='20000000-0000-0000-0000-000000000402',otherAdmin='10000000-0000-0000-0000-000000000402';
   // 9,000 historical rows in one tenant and 1,000 actionable rows in another.
   await q(`begin;${auth}insert into public.tickets(organization_id,requester_id,title,description)select '${org}','${admin}','Historical '||n,'Synthetic' from generate_series(1,9000)n;commit;`);
   const otherAuth=auth.replaceAll(admin,otherAdmin);
   const draft=definition({conditions:group(),actions:[action('add_internal_note',{body:'Synthetic'})]});
   await q(`begin;${otherAuth}do $$declare r public.automation_rules;begin r:=public.create_automation_rule('${other}',${lit(draft)});perform public.set_automation_rule_enabled('${other}',r.id,1,true);end $$;commit;select private.set_automation_processing(true);`);
   try{
    await q(`begin;${otherAuth}insert into public.tickets(organization_id,requester_id,title,description)select '${other}','${otherAdmin}','Ready '||n,'Synthetic' from generate_series(1,1000)n;commit;analyze private.domain_event_deliveries;analyze private.domain_events;analyze private.automation_tenant_schedule;analyze public.automation_rules;`);
    const migration=await readFile('supabase/migrations/20261003005804_automation_guardrails_corrections.sql','utf8');
    let candidate=migration.split('  for delivery in\n')[1].split('\n  loop')[0];
    candidate=candidate.replaceAll('tenant.organization_id',`'${other}'::uuid`).replaceAll('tenant.queue_scan_at','null::timestamptz').replaceAll('tenant.queue_scan_id','null::uuid').replaceAll('tenant.last_was_retry','false').replaceAll('batch_size*100-inspected','500').replace(/\bstamp\b/g,'statement_timestamp()');
    report.candidatePlan=await json(`begin;explain(analyze,buffers,format json)${candidate};rollback;`);
    report.claimPlan=await json('begin;set local role service_role;explain(analyze,buffers,format json)select * from public.claim_automation_events();rollback;');
    assert.equal(report.claimPlan[0].Plan['Actual Rows'],5);report.deliveries=10000;
    report.indexes=await json("select json_agg(json_build_object('name',indexname,'definition',indexdef)) from pg_indexes where indexname in ('automation_deliveries_pending_org','automation_schedule_claim','domain_event_deliveries_pkey','automation_rules_active_trigger')");
   }finally{await q('select private.set_automation_processing(false)');}
  }
  if(mode==='concurrency'){
   await q(await readFile('tests/fixtures/domain-events.sql','utf8'));
   const requester='10000000-0000-0000-0000-000000000404';
   const draft=definition({conditions:group(),actions:[action('send_notification',{recipient:'requester',template:'ticket_update'})]});
   const rule=await q(`begin;${auth}select id from public.create_automation_rule('${org}',${lit(draft)});commit;`);
   await q(`begin;${auth}select public.set_automation_rule_enabled('${org}','${rule}',1,true);commit;select private.set_automation_processing(true);`);
   try{
    const leases=async()=>{
     await q(`begin;${auth}insert into public.tickets(organization_id,requester_id,title,description)select '${org}','${requester}','Contention '||n,'Synthetic' from generate_series(1,2)n;commit;`);
     return json("begin;set local role service_role;select json_agg(row_to_json(d)) from public.claim_automation_events(5,120)d;commit;");
    };
    const pair=await leases();assert.equal(pair.length,2);
    const begin=d=>`select row_to_json(x) from public.begin_automation_execution('${d.delivery_id}','${d.lease_token}','${rule}',2)x;`;
    await q(`insert into private.automation_capacity(organization_id,resource,window_started_at,used)values('${org}','executions',clock_timestamp(),119);`);
    const first=query(`begin;set local role service_role;${begin(pair[0])}select 'LOCKED';select pg_sleep(0.3);commit;`,'admitting');await first.locked;
    await assert.rejects(q(`begin;set local role service_role;${begin(pair[1])}commit;`),{code:'FF002'});await first.done;
    assert.equal(await q("select used from private.automation_capacity where resource='executions'"),'120');report.executionCeiling='PASS';
    await q("update private.automation_capacity set window_started_at=clock_timestamp()-interval '61 seconds' where resource='executions'");
    await q(`begin;set local role service_role;${begin(pair[1])}commit;`);
    const executions=await json('select json_agg(row_to_json(x))from public.automation_executions x');
    const execute=(x,p)=>{const d=p.find(d=>d.delivery_id===x.delivery_id);return `select row_to_json(s) from public.execute_automation_ticket_step('${x.id}','${d.lease_token}',${lit({organizationId:org,entityId:x.entity_id,action:draft.actions[0]})})s;`;};
    await q(`insert into private.automation_capacity(organization_id,resource,subject,window_started_at,used)values('${org}','recipientNotifications','${requester}',clock_timestamp(),19);`);
    const notification=query(`begin;set local role service_role;${execute(executions[0],pair)}select 'LOCKED';select pg_sleep(0.3);commit;`,'notifying');await notification.locked;
    await assert.rejects(q(`begin;set local role service_role;${execute(executions[1],pair)}commit;`),{code:'FF003'});await notification.done;
    assert.equal(await q('select count(*)from public.notifications'),'1');assert.equal(await q("select used from private.automation_capacity where resource='recipientNotifications'"),'20');
    assert.equal(await q(`select attempts from public.automation_execution_steps where execution_id='${executions[1].id}'`),'0');report.recipientCeiling='PASS';
    // Completed receipts do not enqueue twice or charge saturated counters again.
    await q(`begin;set local role service_role;${execute(executions[0],pair)}commit;`);assert.equal(await q('select count(*)from public.notifications'),'1');
    const second=await leases();assert.equal(second.length,2);for(const d of second)await q(`begin;set local role service_role;${begin(d)}commit;`);
    const pending=await json(`select json_agg(row_to_json(x))from public.automation_executions x where delivery_id in ('${second[0].delivery_id}','${second[1].delivery_id}')`);
    await q("update private.automation_capacity set used=case resource when 'notifications' then 119 else 0 end,window_started_at=clock_timestamp()where resource in ('notifications','recipientNotifications')");
    const tenantNotification=query(`begin;set local role service_role;${execute(pending[0],second)}select 'LOCKED';select pg_sleep(0.3);commit;`,'tenant-notifying');await tenantNotification.locked;
    await assert.rejects(q(`begin;set local role service_role;${execute(pending[1],second)}commit;`),{code:'FF003'});await tenantNotification.done;
    assert.equal(await q("select used from private.automation_capacity where resource='notifications'"),'120');assert.equal(await q('select count(*)from public.notifications'),'2');report.tenantNotificationCeiling='PASS';
    const deferred=second.find(d=>d.delivery_id===pending[1].delivery_id);
    await q(`begin;set local role service_role;select public.finish_domain_event_delivery('${deferred.delivery_id}','${deferred.lease_token}','deferred','notification_deferred_capacity');commit;`);
    assert.equal(await q(`select attempts from private.domain_event_deliveries where id='${deferred.delivery_id}'`),'0');report.deferralRefund='PASS';
   }finally{await q('select private.set_automation_processing(false)');}
  }

 }
 report.processing=await q('select active from private.automation_processing_state');assert.equal(report.processing,'f');report.result=mode==='advisors'&&report.advisorExit!==0?'BLOCKED':'PASS';
}finally{
 report.finishedAt=new Date().toISOString();await writeFile(`/tmp/fixxflow-stage12-corrections-${mode}.json`,JSON.stringify(report,null,2)+'\n');
 docker('stop',container);
}
console.log(JSON.stringify(report));
