/** Restore only freshly exported synthetic local data into a separate empty stack. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
import assert from 'node:assert/strict';
const source='supabase_db_fixxflow-stage12b-upgrade',target='supabase_db_fixxflow-stage12b-restore';
for(const name of ['upgrade','restore'])assert.match(readFileSync(`/tmp/fixxflow-stage12b-${name}/supabase/config.toml`,'utf8'),new RegExp(`project_id = "fixxflow-stage12b-${name}"`));
const q=(container,input)=>execFileSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:32*1024*1024}).trim();
assert.equal(q(source,'select active from private.automation_processing_state'),'f');
const completePolicies=process.argv.includes('--complete-managed-policies');
assert.equal(q(target,"select to_regclass('public.automation_rules') is null"),completePolicies?'f':'t');
const files=['schema','data','history-schema','history-data'];
for(const name of files)chmodSync(`/tmp/fixxflow-stage12b-${name}.sql`,0o600);
const contents=Object.fromEntries(files.map(name=>[name,readFileSync(`/tmp/fixxflow-stage12b-${name}.sql`,'utf8')]));
assert.doesNotMatch(contents.data,/COPY "storage"\."(?:buckets_vectors|vector_indexes)"/);
// The CLI excludes managed schemas. Preserve the app's Storage/Realtime policies
// explicitly, as required by the Supabase restore guide's custom-schema section.
const policyExport=`select format('create policy %I on %I.%I as %s for %s to %s%s%s;',policyname,schemaname,tablename,permissive,cmd,array_to_string(array(select quote_ident(x) from unnest(roles)x),','),case when qual is null then '' else ' using ('||qual||')' end,case when with_check is null then '' else ' with check ('||with_check||')' end) from pg_policies where (schemaname,tablename) in (('storage','objects'),('realtime','messages')) order by schemaname,tablename,policyname`;
const policies=q(source,policyExport);
writeFileSync('/tmp/fixxflow-stage12b-managed-policies.sql',policies,{mode:0o600});
if(completePolicies){
 assert.equal(q(target,"select count(*) from pg_policies where (schemaname,tablename) in (('storage','objects'),('realtime','messages'))"),'0');
 q(target,`begin;\n${policies}\ncommit;`);
}else q(target,`begin;\n${contents.schema}\n${policies}\nSET session_replication_role = replica;\n${contents.data}\n${contents['history-schema']}\n${contents['history-data']}\ncommit;`);
// Compare every row, not only counts. Platform-internal schemas are excluded from
// equality: application provenance/history and synthetic identities are included.
const tables=q(source,"select schemaname||'.'||tablename from pg_tables where schemaname in ('public','private','supabase_migrations') order by 1").split('\n');
tables.push('auth.users');
for(const table of tables){assert.match(table,/^[a-z_]+\.[a-z_]+$/);const digest=`select md5(coalesce(string_agg(row::text,E'\\n' order by row::text),'')) from (select to_jsonb(t) row from ${table} t)s`;assert.equal(q(target,digest),q(source,digest),table);}
assert.equal(q(target,policyExport),policies);
assert.equal(q(target,'select active from private.automation_processing_state'),'f');
assert.equal(q(target,'select count(*) from supabase_migrations.schema_migrations'),'40');
// All restored tenant FK references still resolve after replica-mode import.
assert.equal(q(target,`select count(*) from public.automation_executions x left join public.automation_rule_versions v on(v.organization_id,v.rule_id,v.version)=(x.organization_id,x.rule_id,x.rule_version) where v.rule_id is null`),'0');
const report={engine:q(target,'show server_version'),method:'Supabase CLI schema/data/history; replica-mode transaction; managed vector tables excluded',tablesCompared:tables.length,rowDigests:'PASS',migrationLedger:40,enabledRules:Number(q(target,'select count(*) from public.automation_rules where enabled')),tickets:Number(q(target,'select count(*) from public.tickets')),processing:'OFF',scope:'Isolated local restore; no hosted platform configuration or Storage object bytes restored'};
writeFileSync('/tmp/fixxflow-stage12b-restore-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
