/** Competing public administration command for the local browser conflict test. */
import { readFileSync } from 'node:fs';
import { sql, literal } from './automation-stage12c-local.mjs';
const { orgA, users } = JSON.parse(readFileSync('/tmp/fixxflow-stage12c-test-session.json', 'utf8'));
sql(`begin;set local role authenticated;select set_config('request.jwt.claims',${literal(JSON.stringify({ sub: users[0].id, role: 'authenticated', aal: 'aal2' }))},true);
do $$declare r public.automation_rules;begin select *into strict r from public.automation_rules where organization_id='${orgA}' and definition->>'name'='Stage12C UI note';perform public.update_automation_rule('${orgA}',r.id,r.version,jsonb_set(r.definition,'{description}','"Changed by an independent synthetic administrator session"'));end $$;commit;`);
console.log('Independent synthetic administrator revision committed.');
