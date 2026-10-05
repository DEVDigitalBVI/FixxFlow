/** Disposable Supabase PG17 upgrade/restore rehearsal. Fixed local container only. */
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {definition,action,group} from '../fixtures/automation.mjs';
const container='supabase_db_fixxflow-stage12b-upgrade',workdir='/tmp/fixxflow-stage12b-upgrade';
assert.match(readFileSync(`${workdir}/supabase/config.toml`,'utf8'),/project_id = "fixxflow-stage12b-upgrade"/);
const q=(input,db='postgres')=>execFileSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024}).trim();
assert.match(q('show server_version'),/^17\./);assert.equal(q('select count(*) from supabase_migrations.schema_migrations'),'39');
q(readFileSync('tests/fixtures/domain-events.sql','utf8'));
const org='20000000-0000-0000-0000-000000000401',admin='10000000-0000-0000-0000-000000000401';
const identity=`set local role authenticated;select set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal1"}',true);`;
const draft=JSON.stringify(definition({conditions:group(),actions:[action('add_internal_note',{body:'Synthetic legacy history'})]}));
q(`begin;${identity}do $$ declare r public.automation_rules;begin for i in 1..101 loop r:=public.create_automation_rule('${org}','${draft}'::jsonb);perform public.set_automation_rule_enabled('${org}',r.id,1,true);end loop;end $$;commit;select private.set_automation_processing(true);`);
q(`begin;${identity}insert into public.tickets(organization_id,requester_id,title,description) select '${org}','${admin}','Upgrade synthetic '||n,'Synthetic only' from generate_series(1,2000)n;commit;`);
// Real immutable execution history before the upgrade, one successful action.
const lease=JSON.parse(q('begin;set local role service_role;select row_to_json(d) from public.claim_automation_events(1,120)d;commit;'));
const rule=q('select id from public.automation_rules order by created_at,id limit 1');
const execution=JSON.parse(q(`begin;set local role service_role;select row_to_json(e) from public.begin_automation_execution('${lease.delivery_id}','${lease.lease_token}','${rule}',2)e;commit;`));
const command=JSON.stringify({organizationId:org,entityId:execution.entity_id,action:JSON.parse(draft).actions[0]});
q(`begin;set local role service_role;select public.execute_automation_ticket_step('${execution.id}','${lease.lease_token}','${command}'::jsonb);commit;select private.set_automation_processing(false);`);
const snapshot=()=>q(`select jsonb_build_object('rules',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.automation_rules t),'versions',(select md5(jsonb_agg(to_jsonb(t) order by rule_id,version)::text) from public.automation_rule_versions t),'executions',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.automation_executions t),'steps',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.automation_execution_steps t),'messages',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.ticket_messages t),'processing',(select to_jsonb(t) from private.automation_processing_state t))`);
const before=snapshot();
copyFileSync('supabase/migrations/20261002202406_automation_guardrails.sql',`${workdir}/supabase/migrations/20261002202406_automation_guardrails.sql`);
// Hold an ordinary read lock. The DDL must wait, then complete without repair.
const holder=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
await new Promise((resolve,reject)=>{holder.on('error',reject);holder.stdout.on('data',d=>{if(String(d).includes('LOCKED'))resolve();});holder.stdin.end("begin;lock table private.domain_event_deliveries in access share mode;select 'LOCKED';select pg_sleep(4);commit;");});
const start=performance.now();
const migration=spawn('npx',['--yes','supabase','migration','up','--local','--workdir',workdir],{stdio:['ignore','pipe','pipe']});
let migrationOutput='';migration.stdout.on('data',d=>migrationOutput+=d);migration.stderr.on('data',d=>migrationOutput+=d);
const done=new Promise((resolve,reject)=>{migration.on('error',reject);migration.on('close',code=>code===0?resolve():reject(Error('Local migration failed; inspect private migration log')));});
let sawLockWait=false;
for(let i=0;i<12;i++) {await new Promise(r=>setTimeout(r,200));if(q("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like '%automation_safety_limits%' ")!=='0')sawLockWait=true;}
await done;writeFileSync('/tmp/fixxflow-stage12b-upgrade-migration.log',migrationOutput);
assert.equal(snapshot(),before);assert.equal(q('select count(*) from supabase_migrations.schema_migrations'),'40');
assert.equal(q('select count(*) from public.automation_rules where enabled'),'101');
assert.throws(()=>q(`begin;${identity}do $$ declare r public.automation_rules;begin r:=public.create_automation_rule('${org}','${draft}'::jsonb);perform public.set_automation_rule_enabled('${org}',r.id,1,true);end $$;commit;`),/Active automation safety limit/);
assert.equal(q('select count(*) from public.automation_rules where enabled'),'101');
const report={engine:q('show server_version'),cleanPreStage12Ledger:39,upgradedLedger:40,legacyEnabledRules:101,tickets:2000,deliveries:Number(q('select count(*) from private.domain_event_deliveries')),executions:1,steps:1,immutableSnapshot:'PASS',furtherEnableDenied:'PASS',migrationElapsedMs:performance.now()-start,observedLockWait:sawLockWait,processing:'OFF'};
writeFileSync('/tmp/fixxflow-stage12b-upgrade-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
// Use the separate supported CLI export + automation-stage12b-restore.mjs workflow.
