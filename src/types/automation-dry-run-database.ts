import type { Json } from './database.generated';
export type AutomationDryRunFunctions = {
  read_automation_dry_run: {
    Args: { target_organization_id: string; ticket_id: string; event_id?: string | null; rule_id?: string | null; rule_version?: number | null; draft?: Json | null };
    Returns: Json;
  };
};
