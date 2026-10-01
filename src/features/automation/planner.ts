import type { AutomationAction, ConditionResult, ValidationIssue } from './model';
import type { AutomationRegistry } from './registries';
import { evaluateConditions } from './conditions';
import { actionReferences, validateEvent, validateRule, validateSnapshotField } from './validation';
import { isUuid } from './values';

export type AutomationPlan = {
  readonly status: 'invalid_rule' | 'invalid_event' | 'tenant_mismatch' | 'disabled' | 'incompatible_trigger' | 'condition_error' | 'conditions_failed' | 'ready';
  readonly triggerCompatible: boolean | null;
  readonly conditions: readonly ConditionResult[];
  readonly actions: readonly { action: AutomationAction; references: readonly { organizationId: string; resource: string; id: string }[] }[];
  readonly issues: readonly ValidationIssue[];
  /** A plan never establishes authorization, record existence, or active membership. */
  readonly validationScope: 'structural_only';
  readonly failurePolicy: 'stop';
};

/** Pure planning only. The caller supplies a trusted tenant context, not form data. */
export function planAutomation(ruleInput: unknown, eventInput: unknown, registry: AutomationRegistry, organizationId: string): AutomationPlan {
  const base: AutomationPlan = { status: 'invalid_rule', triggerCompatible: null, conditions: [], actions: [], issues: [], validationScope: 'structural_only', failurePolicy: 'stop' };
  const rule = validateRule(ruleInput, registry);
  if (!rule.valid) return { ...base, issues: rule.issues };
  const event = validateEvent(eventInput);
  if (!event.valid) return { ...base, status: 'invalid_event', issues: event.issues };
  if (!isUuid(organizationId) || rule.value.organizationId.toLowerCase() !== organizationId.toLowerCase() || event.value.organizationId.toLowerCase() !== organizationId.toLowerCase()) return { ...base, status: 'tenant_mismatch', issues: [{ path: 'organizationId', code: 'tenant_mismatch', message: 'Rule and event must belong to the current organization.' }] };
  if (!rule.value.enabled) return { ...base, status: 'disabled' };
  const trigger = registry.trigger(rule.value.definition.trigger.type)!;
  if (event.value.type !== trigger.key || event.value.entityType !== trigger.entityType || event.value.schemaVersion !== trigger.eventSchemaVersion) return { ...base, status: 'incompatible_trigger', triggerCompatible: false };
  const validBefore = trigger.beforeFields.every(key => validateSnapshotField(event.value.before, registry.field(trigger.entityType, key)!));
  const validAfter = trigger.afterFields.every(key => validateSnapshotField(event.value.after, registry.field(trigger.entityType, key)!));
  if (!validBefore || !validAfter) return { ...base, status: 'invalid_event', issues: [{ path: 'event', code: 'invalid_trigger_context', message: 'The trigger requires valid before/after field values.' }] };
  try {
    if (!trigger.matches(event.value, rule.value.definition.trigger.configuration)) return { ...base, status: 'incompatible_trigger', triggerCompatible: false };
  } catch {
    return { ...base, status: 'invalid_event', issues: [{ path: 'event', code: 'trigger_adapter_failed', message: 'Trigger compatibility could not be evaluated.' }] };
  }
  const evaluation = evaluateConditions(rule.value.definition.conditions, event.value.after, registry, trigger.entityType);
  const result = { ...base, triggerCompatible: true, conditions: evaluation.results, issues: evaluation.issues };
  if (evaluation.issues.length || evaluation.results.some(condition => condition.status === 'error')) return { ...result, status: 'condition_error' };
  if (!evaluation.passed) return { ...result, status: 'conditions_failed' };
  return { ...result, status: 'ready', actions: rule.value.definition.actions.map(action => ({ action, references: actionReferences(action, registry).map(reference => ({ ...reference, organizationId: rule.value.organizationId })) })) };
}
