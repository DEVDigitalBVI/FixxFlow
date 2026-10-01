import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type { AutomationRuleRow, AutomationVersionRow } from '@/types/automation-database';
import type { AutomationDefinition } from './model';
import type { AutomationRuleVersion, PersistedAutomationRule } from './persistence-model';
import { persistenceRegistry } from './persistence-contract';
import { validateDefinition, validateRule } from './validation';

export class AutomationPersistenceError extends Error {
  constructor(readonly code: string) { super('Automation persistence failed'); }
}

function readRule(row: AutomationRuleRow, organizationId: string): PersistedAutomationRule {
  const rule = validateRule({ id: row.id, organizationId: row.organization_id, enabled: row.enabled, version: row.version,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, definition: row.definition }, persistenceRegistry);
  if (row.organization_id !== organizationId || !rule.valid || (row.archived_at !== null && row.enabled)) throw new AutomationPersistenceError('invalid_storage');
  return { rule: rule.value, updatedBy: row.updated_by, enabledAt: row.enabled_at, archivedAt: row.archived_at };
}
function readVersion(row: AutomationVersionRow, organizationId: string, ruleId: string): AutomationRuleVersion {
  const definition = validateDefinition(row.definition, persistenceRegistry);
  if (row.organization_id !== organizationId || row.rule_id !== ruleId || !definition.valid) throw new AutomationPersistenceError('invalid_storage');
  return { organizationId, ruleId, version: row.version, definition: definition.value, enabled: row.enabled,
    enabledAt: row.enabled_at, archivedAt: row.archived_at, createdBy: row.created_by, createdAt: row.created_at };
}
function requireData<T>(response: { data: T | null; error: { code: string } | null }): NonNullable<T> {
  if (response.error) throw new AutomationPersistenceError(response.error.code);
  if (response.data == null) throw new AutomationPersistenceError('P0002');
  return response.data;
}

/** Session client only. Organization is supplied by the authenticated service;
 * every read is explicitly scoped in addition to the database's RLS checks.
 */
export function automationRepository(client: SupabaseClient<Database>, organizationId: string) {
  const target = (ruleId: string, expectedVersion: number) => ({ target_organization_id: organizationId, rule_id: ruleId, expected_version: expectedVersion });
  const json = (definition: AutomationDefinition): Json => JSON.parse(JSON.stringify(definition)) as Json;
  return {
    async list(page: number, archived: boolean) {
      let query = client.from('automation_rules').select('*').eq('organization_id', organizationId);
      query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
      const rows = requireData(await query.order('updated_at', { ascending: false }).order('id').range((page - 1) * 50, page * 50 - 1));
      return rows.map(row => readRule(row, organizationId));
    },
    async get(ruleId: string) {
      const row = requireData(await client.from('automation_rules').select('*').eq('organization_id', organizationId).eq('id', ruleId).maybeSingle());
      return readRule(row, organizationId);
    },
    async versions(ruleId: string, page: number) {
      const rows = requireData(await client.from('automation_rule_versions').select('*').eq('organization_id', organizationId).eq('rule_id', ruleId)
        .order('version', { ascending: false }).range((page - 1) * 50, page * 50 - 1));
      return rows.map(row => readVersion(row, organizationId, ruleId));
    },
    async create(definition: AutomationDefinition) {
      return readRule(requireData(await client.rpc('create_automation_rule', { target_organization_id: organizationId, definition: json(definition) }).single()), organizationId);
    },
    async update(ruleId: string, expectedVersion: number, definition: AutomationDefinition) {
      return readRule(requireData(await client.rpc('update_automation_rule', { ...target(ruleId, expectedVersion), definition: json(definition) }).single()), organizationId);
    },
    async duplicate(ruleId: string, expectedVersion: number, name: string) {
      return readRule(requireData(await client.rpc('duplicate_automation_rule', { ...target(ruleId, expectedVersion), name }).single()), organizationId);
    },
    async setEnabled(ruleId: string, expectedVersion: number, enabled: boolean) {
      return readRule(requireData(await client.rpc('set_automation_rule_enabled', { ...target(ruleId, expectedVersion), enabled }).single()), organizationId);
    },
    async archive(ruleId: string, expectedVersion: number) {
      return readRule(requireData(await client.rpc('archive_automation_rule', target(ruleId, expectedVersion)).single()), organizationId);
    },
  };
}
