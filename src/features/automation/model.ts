import type { JsonValue } from '@/lib/events/model';

export const conditionOperators = ['equals', 'not_equals', 'contains', 'not_contains', 'is_empty', 'is_not_empty', 'greater_than', 'less_than', 'in', 'not_in'] as const;
export type ConditionOperator = typeof conditionOperators[number];
export type AutomationTrigger = { readonly type: string; readonly configuration: Readonly<Record<string, JsonValue>> };
export type AutomationCondition = {
  readonly kind: 'condition';
  readonly id: string;
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly value?: JsonValue;
};
/** Recursive storage contract; V1 validation accepts only a flat AND root. */
export type AutomationConditionGroup = {
  readonly kind: 'group';
  readonly id: string;
  readonly operator: 'and' | 'or';
  readonly children: readonly (AutomationCondition | AutomationConditionGroup)[];
};
export type AutomationAction = {
  readonly id: string;
  readonly type: string;
  /** Contiguous, zero-based order; array arrival order is not authoritative. */
  readonly position: number;
  readonly configuration: Readonly<Record<string, JsonValue>>;
};
export type AutomationDefinition = {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly description: string | null;
  readonly trigger: AutomationTrigger;
  readonly conditions: AutomationConditionGroup;
  readonly actions: readonly AutomationAction[];
};
export type AutomationRule = {
  readonly id: string;
  readonly organizationId: string;
  readonly enabled: boolean;
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly definition: AutomationDefinition;
};
export type SafeAutomationError = { readonly code: string; readonly message: string };
export type AutomationExecution = {
  readonly id: string;
  readonly organizationId: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly eventId: string;
  readonly triggerType: string;
  readonly ruleName: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly correlationId: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly status: 'running' | 'succeeded' | 'failed' | 'partially_completed' | 'skipped';
  readonly conditions: readonly ConditionResult[];
  readonly actionsAttempted: number;
  readonly error: SafeAutomationError | null;
};
export type AutomationExecutionStep = {
  readonly id: string;
  readonly organizationId: string;
  readonly executionId: string;
  readonly actionId: string;
  readonly actionType: string;
  readonly position: number;
  readonly idempotencyKey: string;
  readonly attempts: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'not_attempted';
  /** Allowlisted result codes/references only; no action bodies or provider payloads. */
  readonly result: { readonly code: string; readonly entityType?: string; readonly entityId?: string } | null;
  readonly error: SafeAutomationError | null;
};
export type ValidationIssue = { readonly path: string; readonly code: string; readonly message: string };
export type ValidationResult<T> = { readonly valid: true; readonly value: T } | { readonly valid: false; readonly issues: readonly ValidationIssue[] };
export type ConditionResult = {
  readonly id: string;
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly status: 'passed' | 'failed' | 'error';
  readonly error?: SafeAutomationError;
};
