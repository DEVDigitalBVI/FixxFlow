import type { Json } from './database.generated';
import type { AutomationExecution, AutomationExecutionStep } from '@/features/automation/model';

export type AutomationFailureCode = 'stale_entity' | 'unavailable_reference' | 'rule_unavailable' | 'processing_inactive' | 'unsupported_action' | 'chain_limit' | 'notification_fanout_limit' | 'action_failed' | 'retry_exhausted' | 'delivery_failed';
/** Stage 4 read/RPC extension; no direct client writes or private-table API. */
export type AutomationExecutionRow = {
  id: string; organization_id: string; rule_id: string; rule_version: number; rule_name: string;
  event_id: string; delivery_id: string; trigger_type: string; entity_type: string; entity_id: string;
  correlation_id: string; causation_id: string | null; root_event_id: string; depth: number;
  processing_generation: number; expected_entity_revision: number;
  started_at: string; completed_at: string | null; duration_ms: number | null;
  status: AutomationExecution['status']; conditions: Json; actions_attempted: number; error_code: AutomationFailureCode | null;
};
export type AutomationExecutionStepRow = {
  id: string; organization_id: string; execution_id: string; action_id: string; action_type: string; position: number;
  idempotency_key: string; attempts: number; status: AutomationExecutionStep['status'];
  started_at: string | null; completed_at: string | null; duration_ms: number | null;
  result: Json | null; error_code: AutomationFailureCode | null;
};
export type AutomationExecutionTables = {
  automation_executions: { Row: AutomationExecutionRow; Insert: never; Update: never; Relationships: [] };
  automation_execution_steps: { Row: AutomationExecutionStepRow; Insert: never; Update: never; Relationships: [] };
};
export type AutomationExecutionFunctions = {
  begin_automation_execution: { Args: { delivery_id: string; token: string; rule_id: string; rule_version: number }; Returns: AutomationExecutionRow[] };
  execute_automation_ticket_step: { Args: { execution_id: string; token: string; command: Json }; Returns: AutomationExecutionStepRow[] };
};
