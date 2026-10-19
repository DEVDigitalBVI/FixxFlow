/** Tenant-scoped dry-run side-effect snapshot while other tenants run a load test. */
import { readAutomationArtifact, writeAutomationArtifact } from './automation-artifacts.mjs';
import assert from 'node:assert/strict';
import { sql, literal } from './automation-stage12c-local.mjs';
const { orgA } = JSON.parse(readAutomationArtifact('fixxflow-stage12c-test-session.json', 'utf8'));
const tables = ['public.tickets', 'public.automation_rules', 'public.automation_rule_versions',
  'private.domain_events', 'private.domain_event_deliveries', 'public.automation_executions',
  'public.automation_execution_steps', 'public.notifications', 'private.automation_capacity',
  'private.automation_tenant_schedule'];
const snapshot = Object.fromEntries(tables.map(table => [table, sql(`select coalesce(md5(string_agg(row_json,''order by row_json)),'empty')from(select to_jsonb(t)::text row_json from ${table} t where organization_id=${literal(orgA)})s`)]));
const file = 'fixxflow-stage12c-ui-dry-run-before.json';
if (process.argv[2] === 'before') writeAutomationArtifact(file, JSON.stringify(snapshot));
else { assert.equal(process.argv[2], 'after'); assert.deepEqual(snapshot, JSON.parse(readAutomationArtifact(file, 'utf8'))); console.log('PASS browser dry run: ten tenant-scoped table digests unchanged'); }
