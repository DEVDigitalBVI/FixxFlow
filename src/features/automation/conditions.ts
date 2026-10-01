import type { EntitySnapshot, JsonValue } from '@/lib/events/model';
import type { AutomationCondition, ConditionResult, ValidationIssue } from './model';
import type { AutomationRegistry, FieldRegistration } from './registries';
import { isBoundedJson, isIdentifier, isRecord, hasOnly } from './values';
import { automationLimits, validateCondition, validateSnapshotField } from './validation';

export type ConditionEvaluation = { readonly passed: boolean; readonly results: readonly ConditionResult[]; readonly issues: readonly ValidationIssue[] };

function compare(actual: JsonValue, condition: AutomationCondition, field: FieldRegistration): boolean {
  const expected = condition.value;
  const empty = actual === null || (typeof actual === 'string' && actual.trim() === '') || (Array.isArray(actual) && actual.length === 0);
  if (condition.operator === 'is_empty') return empty;
  if (condition.operator === 'is_not_empty') return !empty;
  // Null never matches a value comparison, including negative operators.
  if (actual === null) return false;
  const normalize = (value: JsonValue | undefined) => typeof value === 'string' && (field.value.kind === 'string' || field.value.kind === 'reference') ? value.toLowerCase() : value;
  switch (condition.operator) {
    case 'equals': return normalize(actual) === normalize(expected);
    case 'not_equals': return normalize(actual) !== normalize(expected);
    case 'in': return (expected as readonly JsonValue[]).some(value => normalize(value) === normalize(actual));
    case 'not_in': return !(expected as readonly JsonValue[]).some(value => normalize(value) === normalize(actual));
    case 'contains':
    case 'not_contains': {
      const contains = typeof actual === 'string' ? actual.toLowerCase().includes((expected as string).toLowerCase()) : (actual as readonly string[]).includes(expected as string);
      return condition.operator === 'contains' ? contains : !contains;
    }
    case 'greater_than':
    case 'less_than': {
      const left = field.value.kind === 'enum' ? field.value.values.indexOf(actual as string) : actual as number;
      const right = field.value.kind === 'enum' ? field.value.values.indexOf(expected as string) : expected as number;
      return condition.operator === 'greater_than' ? left > right : left < right;
    }
  }
}

/** Evaluates every leaf for an explainable result; missing context fails closed. */
export function evaluateConditions(group: unknown, snapshot: unknown, registry: AutomationRegistry, entityType: string): ConditionEvaluation {
  const failure = (code: string, message: string): ConditionEvaluation => ({ passed: false, results: [], issues: [{ path: 'conditions', code, message }] });
  if (!isBoundedJson(group) || !isRecord(group) || !hasOnly(group, ['kind', 'id', 'operator', 'children']) || group.kind !== 'group' || !isIdentifier(group.id) || group.operator !== 'and' || !Array.isArray(group.children) || group.children.length > automationLimits.conditions) return failure('invalid_group', 'V1 supports one flat AND group.');
  if (!isBoundedJson(snapshot) || !isRecord(snapshot)) return failure('invalid_snapshot', 'A structured entity snapshot is required.');
  const results: ConditionResult[] = [];
  const issues: ValidationIssue[] = [];
  const ids = new Set([group.id]);
  for (const [index, child] of group.children.entries()) {
    const checked = validateCondition(child, registry, entityType, `conditions.children.${index}`);
    if (!checked.valid) { issues.push(...checked.issues); continue; }
    const condition = checked.value;
    if (ids.has(condition.id)) { issues.push({ path: `conditions.children.${index}.id`, code: 'duplicate_id', message: 'Condition identifiers must be unique.' }); continue; }
    ids.add(condition.id);
    const field = registry.field(entityType, condition.field)!;
    if (!validateSnapshotField(snapshot as EntitySnapshot, field)) {
      results.push({ id: condition.id, field: condition.field, operator: condition.operator, status: 'error', error: { code: 'invalid_context', message: 'The event is missing a valid value for this field.' } });
      continue;
    }
    results.push({ id: condition.id, field: condition.field, operator: condition.operator, status: compare(snapshot[condition.field] as JsonValue, condition, field) ? 'passed' : 'failed' });
  }
  return { passed: issues.length === 0 && results.every(result => result.status === 'passed'), results, issues };
}
