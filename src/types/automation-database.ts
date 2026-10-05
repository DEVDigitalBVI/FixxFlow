import type { Json } from './database.generated';

/** Stage 2 schema extension. Kept separate from the hosted generated snapshot.
 * Column/function signatures are checked against a clean migration replay.
 * DML is RPC-only; Insert/Update deliberately have no application API.
 */
export type AutomationRuleRow = {
  id: string; organization_id: string; definition: Json;
  name: string | null; description: string | null; trigger_type: string | null;
  trigger_configuration: Json | null; conditions: Json | null; actions: Json | null;
  enabled: boolean; version: number; created_by: string; updated_by: string;
  created_at: string; updated_at: string; enabled_at: string | null; archived_at: string | null;
};
export type AutomationVersionRow = {
  organization_id: string; rule_id: string; version: number; definition: Json;
  enabled: boolean; enabled_at: string | null; archived_at: string | null;
  created_by: string; created_at: string;
};
export type AutomationTables = {
  automation_rules: { Row: AutomationRuleRow; Insert: never; Update: never; Relationships: [] };
  automation_rule_versions: { Row: AutomationVersionRow; Insert: never; Update: never; Relationships: [] };
};
type Target = { target_organization_id: string; rule_id: string; expected_version: number };
export type AutomationFunctions = {
  create_automation_rule: { Args: { target_organization_id: string; definition: Json }; Returns: AutomationRuleRow[] };
  update_automation_rule: { Args: Target & { definition: Json }; Returns: AutomationRuleRow[] };
  duplicate_automation_rule: { Args: Target & { name: string }; Returns: AutomationRuleRow[] };
  set_automation_rule_enabled: { Args: Target & { enabled: boolean }; Returns: AutomationRuleRow[] };
  archive_automation_rule: { Args: Target; Returns: AutomationRuleRow[] };
};
