import type { Json } from './database.generated';
import type { DomainEventFunctions } from './domain-event-database';
import type { AutomationExecutionRow } from './automation-execution-database';

export type AutomationWorkerFunctions = {
  claim_automation_events: { Args: { batch_size?: number; lease_seconds?: number }; Returns: DomainEventFunctions['claim_domain_events']['Returns'] };
  discover_automation_rules: {
    Args: { delivery_id: string; token: string; after_created_at?: string | null; after_rule_id?: string | null; batch_size?: number };
    Returns: { rule: Json; sort_created_at: string; rule_id: string }[];
  };
  get_automation_execution: { Args: { execution_id: string; token: string }; Returns: AutomationExecutionRow[] };
};
