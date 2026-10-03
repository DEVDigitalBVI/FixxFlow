// Generate a SQL reproduction for an EMPTY disposable PostgreSQL database.
// No connection, credential or hosted URL is accepted. SQL goes to stdout.
import { readFile, readdir } from 'node:fs/promises';
import { definition, group, action } from '../fixtures/automation.mjs';
const org = '20000000-0000-0000-0000-000000000401';
const other = '20000000-0000-0000-0000-000000000402';
const admin = '10000000-0000-0000-0000-000000000401';
const otherAdmin = '10000000-0000-0000-0000-000000000402';
const draft = definition({ conditions: group(), trigger: { type: 'ticket.open_duration_reached', configuration: { durationMinutes: 1 } }, actions: Array.from({ length: 5 }, (_, i) => action('add_internal_note', { body: '界'.repeat(18000) }, i)) });
const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const migrations = (await readdir('supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
if (migrations.length !== 40 || migrations.at(-1) !== '20261002202406_automation_guardrails.sql') throw Error('Recheck audit baseline before replay');
console.log('\\set ON_ERROR_STOP on\n\\o /dev/null');
console.log(await readFile('tests/fixtures/supabase-bootstrap.sql', 'utf8'));
for (const file of migrations.slice(0, -1)) console.log(await readFile(`supabase/migrations/${file}`, 'utf8'));
console.log(await readFile('tests/fixtures/domain-events.sql', 'utf8'));
console.log(`begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal1"}',true);
do $$ declare r public.automation_rules; begin
 r:=public.create_automation_rule('${org}',${literal(draft)});
 perform public.set_automation_rule_enabled('${org}',r.id,r.version,true);
end $$;
select set_config('request.jwt.claims','{"sub":"${otherAdmin}","role":"authenticated","aal":"aal1"}',true);
do $$ declare r public.automation_rules; begin
 r:=public.create_automation_rule('${other}',${literal({ ...draft, actions: [action('add_internal_note', { body: 'Healthy tenant' })] })});
 perform public.set_automation_rule_enabled('${other}',r.id,r.version,true);
end $$;
commit;`);
console.log(await readFile(`supabase/migrations/${migrations.at(-1)}`, 'utf8'));
console.log(`begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated","aal":"aal1"}',true);
do $$ declare r public.automation_rules; blocked integer:=0; begin
 select * into strict r from public.automation_rules where organization_id='${org}';
 begin perform public.set_automation_rule_enabled('${org}',r.id,r.version,false); exception when sqlstate 'FF004' then blocked:=blocked+1; end;
 begin perform public.archive_automation_rule('${org}',r.id,r.version); exception when sqlstate 'FF004' then blocked:=blocked+1; end;
 if blocked<>2 then raise exception 'Legacy control reproduction changed'; end if;
end $$;
reset role;
select private.set_automation_processing(true);
set local role service_role;
do $$ declare blocked integer:=0; begin
 for i in 1..3 loop
  begin perform public.discover_temporal_automation(); exception when sqlstate 'FF004' then blocked:=blocked+1; end;
 end loop;
 if blocked<>3 then raise exception 'Discovery reproduction changed'; end if;
end $$;
reset role;
do $$ begin
 if exists(select 1 from private.automation_tenant_schedule where last_discovered_at<>'-infinity') or exists(select 1 from private.automation_temporal_cursors) then raise exception 'Unexpected tenant progress'; end if;
end $$;
select private.set_automation_processing(false);
commit;
\\o
select jsonb_build_object('postgres',current_setting('server_version'),'legacyDefinitionBytes',${Buffer.byteLength(JSON.stringify(draft))},'disable','FF004','archive','FF004','failedDiscoveryInvocations',3,'healthyTenantScans',0,'processingActive',(select active from private.automation_processing_state));`);
