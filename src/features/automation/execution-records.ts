import type {
  AutomationExecutionRow,
  AutomationExecutionStepRow,
  AutomationFailureCode,
} from '@/types/automation-execution-database';

import type {
  AutomationAction,
  AutomationExecution,
  AutomationExecutionStep,
  ConditionResult,
  SafeAutomationError,
} from './model';

/** Assertion sent to the trusted ticket adapter, never an authorization token. */
export type AutomationTicketCommand = {
  readonly organizationId: string;
  readonly entityId: string;
  readonly action: AutomationAction;
};

const failureMessages: Record<AutomationFailureCode, string> = {
  retry_exhausted: 'Delivery retries were exhausted. Remaining actions were not executed.',
  delivery_failed: 'Delivery processing failed. Remaining actions were not executed.',
  stale_entity:
    'The ticket changed after this automation observed it. No further actions were performed.',
  unavailable_reference: 'An action target is no longer available to this organization.',
  rule_unavailable: 'The automation was changed, disabled, or archived.',
  processing_inactive: 'Automation processing is inactive or has been restarted.',
  unsupported_action: 'This action is not available for execution.',
  chain_limit: 'The automation chain reached its work limit.',
  notification_fanout_limit:
    'This action would notify more recipients than the safety limit allows. No changes from this action were saved.',
  action_failed: 'The action could not be completed. No changes from this action were saved.',
};
export function executionError(code: AutomationFailureCode | null): SafeAutomationError | null {
  return code ? { code, message: failureMessages[code] } : null;
}
const conditionStatuses: ReadonlySet<unknown> = new Set(['passed', 'failed', 'error']);
/** Stored worker JSON: keep well-formed results only, so history pages never crash on it. */
export function conditionResults(value: unknown): readonly ConditionResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ConditionResult =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.id === 'string' &&
      typeof item.field === 'string' &&
      typeof item.operator === 'string' &&
      conditionStatuses.has(item.status),
  );
}
/** Map trusted database records to the unchanged Stage 1 history contracts. */
export function executionRecord(row: AutomationExecutionRow): AutomationExecution {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    eventId: row.event_id,
    triggerType: row.trigger_type,
    ruleName: row.rule_name,
    entityType: row.entity_type,
    entityId: row.entity_id,
    correlationId: row.correlation_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    status: row.status,
    conditions: conditionResults(row.conditions),
    actionsAttempted: row.actions_attempted,
    error: executionError(row.error_code),
  };
}
export function executionStepRecord(row: AutomationExecutionStepRow): AutomationExecutionStep {
  return {
    id: row.id,
    organizationId: row.organization_id,
    executionId: row.execution_id,
    actionId: row.action_id,
    actionType: row.action_type,
    position: row.position,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    status: row.status,
    result: row.result as AutomationExecutionStep['result'],
    error: executionError(row.error_code),
  };
}
