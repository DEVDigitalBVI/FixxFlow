/** Local-only PG17 corrective verification. Uses a fixed network-isolated Docker
 * container, never a URL or credential. All worker RPCs use independent sessions.
 * prepare: empty cluster replay/upgrade. verify: legacy and concurrency checks.
 * workload: default-cadence sustained load; always restores processing OFF.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { load } from './load-module.mjs';
import { definition, action, group, condition } from '../fixtures/automation.mjs';

const container='fixxflow-stage12-corrections-pg17';
const mode=process.argv[2];
assert.ok(['prepare','verify','workload','stats'].includes(mode));
const org='20000000-0000-0000-0000-000000000401',other='20000000-0000-0000-0000-000000000402';
const admin='10000000-0000-0000-0000-000000000401',otherAdmin='10000000-0000-0000-0000-000000000402';
const lit=x=>x===null?'null':typeof x==='number'?String(x):typeof x==='boolean'?String(x):`'${(typeof x==='object'?JSON.stringify(x):String(x)).replaceAll("'","''")}'${typeof x==='object'?'::jsonb':''}`;
function connection(sql){
 const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{stdio:['pipe','pipe','pipe']});
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 let output='',error='',signal;const locked=new Promise(resolve=>{signal=resolve;});
 child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('LOCKED'))signal();});child.stderr.on('data',chunk=>{error+=chunk;});
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{if(code===0)resolve(output.trim());else {const failure=new Error(`Isolated SQL failed: ${/ERROR:\s+([A-Z0-9]{5})/.exec(error)?.[1]??'unknown'}`);failure.code=/ERROR:\s+([A-Z0-9]{5})/.exec(error)?.[1];reject(failure);}});});
 child.stdin.end(sql);return{done,locked};
}
const q=sql=>connection(sql).done;
const auth=(actor=admin)=>`set local role authenticated;do $$begin perform set_config('request.jwt.claims',${lit(JSON.stringify({sub:actor,role:'authenticated',aal:'aal1'}))},true);end $$;`;
const data=async sql=>JSON.parse(await q(sql));
const failures=load('src/features/automation/worker-failures.ts');
const mocks={'server-only':{},'./worker-failures':failures};
const {runAutomationWorker:runWorker}=load('src/features/automation/worker.ts',mocks);
const {automationWorkerRepository}=load('src/features/automation/worker-repository.ts',mocks);
const allowed=new Set(['claim_automation_events','discover_automation_rules','begin_automation_execution','execute_automation_ticket_step','get_automation_execution','finish_domain_event_delivery']);
const client={rpc(name,args){assert.ok(allowed.has(name));let pending;const run=()=>pending??=(async()=>{
 try{const call=`public.${name}(${Object.entries(args??{}).map(([k,v])=>`${k}=>${lit(v)}`).join(',')})`;
 const value=await data(`begin;set local role service_role;${name==='finish_domain_event_delivery'?`select to_json(${call})`:`select coalesce(json_agg(row_to_json(r)),'[]') from ${call} r`};commit;`);
 return{data:value,error:null,status:200};}
 catch(error){console.error(JSON.stringify({rpc:name,code:error.code??'unknown'}));return{data:null,error:{code:error.code??'unknown'},status:400};}
})();return{then(resolve,reject){return run().then(resolve,reject);},single(){return run().then(result=>({...result,data:result.data?.[0]??null}));}};}};
const store=automationWorkerRepository(client);
const runAutomationWorker=(repository,options)=>runWorker(repository,{...options,log:entry=>console.error(JSON.stringify(entry))});
const create=async(tenant,draft,actor=admin)=>q(`begin;${auth(actor)}do $$declare r public.automation_rules;begin r:=public.create_automation_rule(${lit(tenant)},${lit(draft)});perform public.set_automation_rule_enabled(${lit(tenant)},r.id,r.version,true);end $$;commit;`);
const insert=async(tenant,count,title='Synthetic workload')=>q(`begin;${auth()}insert into public.tickets(organization_id,requester_id,title,description)select ${lit(tenant)},${lit(admin)},${lit(title)}||n,'Synthetic' from generate_series(1,${count})n;commit;`);
const snapshots=()=>data("select json_build_object('rules',(select md5(string_agg(to_jsonb(r)::text,'' order by id)) from public.automation_rules r),'versions',(select md5(string_agg(to_jsonb(v)::text,'' order by rule_id,version))from public.automation_rule_versions v),'active',(select active from private.automation_processing_state))");

assert.match(await q('show server_version'),/^17\./);
if(mode==='prepare'){
 assert.equal(await q("select count(*) from pg_namespace where nspname='private'"),'0','Requires an empty audit cluster');
 await q(await readFile('tests/fixtures/supabase-bootstrap.sql','utf8'));
 const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();let before;
 for(const file of files){
  if(file.endsWith('_automation_guardrails.sql')){
   await q(await readFile('tests/fixtures/domain-events.sql','utf8'));
   const large=definition({conditions:group(),actions:Array.from({length:5},(_,i)=>action('add_internal_note',{body:'界'.repeat(18000)},i))});
   await create(org,large);
   await create(org,{...large,trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:1}}});
   await create(other,{...large,actions:[action('add_internal_note',{body:'Other tenant'})],trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:1}}},otherAdmin);
   before=await snapshots();
  }
  await q(await readFile(`supabase/migrations/${file}`,'utf8'));
 }
 assert.deepEqual(await snapshots(),before);
 console.log(JSON.stringify({mode,migrations:files.length,postgres:await q('show server_version'),legacyRulesAndVersions:'preserved',processing:'OFF'}));
}

if(mode==='verify'){
 assert.equal(await q('select active from private.automation_processing_state'),'f');
 // Real admin disable/archive transactions, rolled back to retain restore fixtures.
 await q(`begin;${auth()}do $$declare r public.automation_rules;begin
 for r in select * from public.automation_rules where organization_id='${org}' loop
  perform public.set_automation_rule_enabled('${org}',r.id,r.version,false);
  begin perform public.set_automation_rule_enabled('${org}',r.id,r.version+1,true);raise exception 'Oversized enable unexpectedly accepted';exception when sqlstate 'FF004' then null;end;
  perform public.archive_automation_rule('${org}',r.id,r.version+1);
 end loop;end $$;rollback;`);
 const tenant=randomUUID();await q(`insert into public.organizations(id,name,slug)values('${tenant}','Contention','correction-${tenant}');insert into public.organization_memberships(organization_id,user_id,role)values('${tenant}','${admin}','administrator');`);
 const draft=definition({conditions:group(),actions:[action('add_internal_note',{body:'Concurrent'})]});
 await q(`begin;${auth()}do $$declare r public.automation_rules;begin for i in 1..99 loop r:=public.create_automation_rule('${tenant}',${lit(draft)});perform public.set_automation_rule_enabled('${tenant}',r.id,1,true);end loop;end $$;commit;`);
 const disabled=async()=>q(`begin;${auth()}select id from public.create_automation_rule('${tenant}',${lit(draft)});commit;`);
 const a=await disabled(),b=await disabled();
 const enabling=connection(`begin;${auth()}select (public.set_automation_rule_enabled('${tenant}','${a}',1,true)).id;select 'LOCKED';select pg_sleep(0.3);commit;`);
 await enabling.locked;await assert.rejects(q(`begin;${auth()}select public.set_automation_rule_enabled('${tenant}','${b}',1,true);commit;`),{code:'FF001'});await enabling.done;
 // Retain one rule for overlapping claims. Counter ceilings remain unchanged.
 await q(`begin;${auth()}do $$declare r public.automation_rules;begin for r in select * from public.automation_rules where organization_id='${tenant}' and enabled and id<>'${a}' loop perform public.set_automation_rule_enabled('${tenant}',r.id,r.version,false);end loop;end $$;commit;`);
 const result={mode,concurrentEnable:'PASS'};
 try{
  await q('select private.set_automation_processing(true)');await insert(tenant,10);
  const concurrent=await Promise.all([store.claim(),store.claim()]);
  const leases=concurrent.flat();assert.ok(leases.length>=5&&leases.length<=10);
  // SKIP LOCKED may correctly skip a tenant owned by the other claimant.
  if(leases.length<10)leases.push(...await store.claim());
  assert.equal(leases.length,10);assert.equal(new Set(leases.map(d=>d.deliveryId)).size,10);
  result.concurrentClaimCounts=concurrent.map(rows=>rows.length);
  result.overlappingClaims='PASS';
  const first=leases[0],[r]=await store.discover(first,null),execution=await store.begin(first,r.rule);
  const receipts=await Promise.all([store.execute(first,execution,r.rule.definition.actions[0]),store.execute(first,execution,r.rule.definition.actions[0])]);
  assert.equal(receipts[0].id,receipts[1].id);assert.equal(receipts[1].attempts,1);
  await runAutomationWorker({...store,claim:async()=>leases},{enabled:true});
  assert.equal(await q(`select count(*) from public.ticket_messages where organization_id='${tenant}'`),'10');result.actionIdempotency='PASS';
  // One real minute establishes legacy and small-tenant temporal eligibility.
  await insert(org,1,'Legacy temporal');
  await q(`begin;${auth(otherAdmin)}insert into public.tickets(organization_id,requester_id,title,description)values('${other}','${otherAdmin}','Small temporal','Synthetic');commit;`);
  await runAutomationWorker(store,{enabled:true});
  console.log(JSON.stringify({mode,phase:'waiting_for_real_temporal_threshold'}));await delay(61000);
  const discovery=await data('begin;set local role service_role;select public.discover_temporal_automation();commit;');
  assert.equal(discovery.rules,2);assert.equal(discovery.emitted,2);
  assert.equal((await runAutomationWorker(store,{enabled:true})).acknowledged,2);
  result.legacyTemporalAndWorker='PASS';
 }finally{await q('select private.set_automation_processing(false)');}
 result.processing=await q('select active from private.automation_processing_state');assert.equal(result.processing,'f');
 await writeFile('/tmp/fixxflow-stage12-corrections-native-results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}

if(mode==='workload'){
 assert.equal(await q('select active from private.automation_processing_state'),'f');
 const tenants=Array.from({length:8},()=>randomUUID());
 for(const [i,tenant] of tenants.entries()){
  await q(`insert into public.organizations(id,name,slug)values('${tenant}','Workload ${i}','correction-${tenant}');insert into public.organization_memberships(organization_id,user_id,role)values('${tenant}','${admin}','administrator');`);
  const actions=[i%2?action('send_notification',{recipient:'requester',template:'ticket_update'}):action('add_internal_note',{body:'Synthetic workload'})];
  await create(tenant,definition({conditions:group(),actions}));
  await create(tenant,definition({conditions:group(condition('title','equals','Never matches')),actions}));
  if(i===7)await create(tenant,definition({conditions:group(),actions,trigger:{type:'ticket.open_duration_reached',configuration:{durationMinutes:1}}}));
 }
 // Deliberately retain an ineligible historical tenant, the original regression.
 await insert(org,1,'Pre-activation noise');
 const report={scope:'Local PG17 + actual TypeScript worker over independent SQL RPC sessions; not HTTP/hosted',configuration:{cadenceSeconds:60,batch:5,steadyMinutes:60,burst:20},startedAt:new Date().toISOString(),samples:[],arrivals:0,result:'RUNNING'};
 const ids=tenants.map(lit).join(',');
 const queue=()=>data(`select json_build_object('total',count(*),'pending',count(*)filter(where status in ('pending','leased')),'acknowledged',count(*)filter(where status='acknowledged'),'dead',count(*)filter(where status='dead'),'capacityDeferred',count(*)filter(where capacity_reason is not null),'oldestSeconds',coalesce(extract(epoch from clock_timestamp()-min(created_at)filter(where status='pending' and available_at<=clock_timestamp())),0),'perTenant',(select json_object_agg(organization_id,n)from(select organization_id,count(*)filter(where status='acknowledged')n from private.domain_event_deliveries where organization_id in (${ids})group by organization_id)t))from private.domain_event_deliveries where organization_id in (${ids})`);
 const save=()=>writeFile('/tmp/fixxflow-stage12-corrections-capacity.json',JSON.stringify(report,null,2)+'\n');
 const tick=async(phase,minute)=>{
  const started=performance.now(),discovery=await data('begin;set local role service_role;select public.discover_temporal_automation();commit;');
  const worker=await runAutomationWorker(store,{enabled:true}),current=await queue();
  report.samples.push({phase,minute,at:new Date().toISOString(),worker,discovery,queue:current,elapsedMs:performance.now()-started});await save();
  console.log(JSON.stringify({phase,minute,worker,queue:current}));
  assert.equal(worker.failed,0);assert.equal(worker.retried,0);assert.equal(current.dead,0);assert.ok(current.pending<200);
  if(phase==='steady')assert.ok(current.oldestSeconds<180,'Steady queue age exceeds three cadences');
  return current;
 };
 try{
  await q('select private.set_automation_processing(true)');let small=0;const started=performance.now();
  for(let minute=0;minute<60;minute++){
   await delay(Math.max(0,started+minute*60000-performance.now()));const large=minute%5<2?3:2;
   await insert(tenants[0],large);for(let n=large;n<4;n++)await insert(tenants[1+small++%7],1);
   report.arrivals+=4;await tick('steady',minute);
  }
  await delay(Math.max(0,started+60*60000-performance.now()));const steady=await tick('steady-drain',60);assert.equal(steady.pending,0);
  await insert(tenants[0],13);for(let i=1;i<8;i++)await insert(tenants[i],1);report.arrivals+=20;
  let remaining;
  for(let minute=61;minute<=70;minute++){await delay(Math.max(0,started+minute*60000-performance.now()));remaining=await tick('burst-drain',minute);if(!remaining.pending)break;}
  assert.equal(remaining.pending,0);assert.ok(Object.values(remaining.perTenant).every(n=>n>0));report.result='PASS';
 }catch(error){report.result='FAIL';report.error=error.message;throw error;}
 finally{await q('select private.set_automation_processing(false)');report.finalProcessingActive=false;report.finishedAt=new Date().toISOString();await save();}
}

if(mode==='stats'){
 const snapshot=await data(`select json_build_object('at',clock_timestamp(),'processingActive',(select active from private.automation_processing_state),'relations',(select json_object_agg(relname,json_build_object('tableBytes',pg_table_size(relid),'indexBytes',pg_indexes_size(relid),'estimatedRows',n_live_tup,'deadRows',n_dead_tup,'lastAutovacuum',last_autovacuum))from pg_stat_user_tables where relname in ('domain_events','domain_event_deliveries','automation_executions','automation_execution_steps','automation_temporal_occurrences','automation_runs','automation_missed_windows','notifications','notification_email_outbox','automation_capacity','automation_tenant_schedule')),'executionLatency',(select json_build_object('count',count(*),'p50Ms',percentile_cont(.5)within group(order by duration_ms),'p95Ms',percentile_cont(.95)within group(order by duration_ms),'maxMs',max(duration_ms))from public.automation_executions where status='succeeded'),'currentLockWaiters',(select count(*)from pg_stat_activity where datname=current_database() and wait_event_type='Lock'),'database',(select json_build_object('commits',xact_commit,'rollbacks',xact_rollback,'deadlocks',deadlocks,'blocksRead',blks_read,'blocksHit',blks_hit,'tempBytes',temp_bytes)from pg_stat_database where datname=current_database()))`);
 console.log(JSON.stringify(snapshot));
}
