import type { DomainEvent } from '@/lib/events/model';
import type { AutomationAction, AutomationCondition, AutomationDefinition, AutomationRule, ValidationIssue, ValidationResult } from './model';
import { conditionOperators } from './model';
import type { AutomationRegistry, FieldRegistration } from './registries';
import { operatorsFor } from './registries';
import { copyJson, hasOnly, isBoundedJson, isIdentifier, isRecord, isTimestamp, isUuid, matchesConfiguration, matchesValue } from './values';

import { automationSafetyLimits } from './limits';
export const automationLimits = automationSafetyLimits.structural;
const issue = (path: string, code: string, message: string): ValidationIssue => ({ path, code, message });
const invalid = <T>(path: string, code: string, message: string): ValidationResult<T> => ({ valid: false, issues: [issue(path, code, message)] });
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export function validateCondition(input: unknown, registry: AutomationRegistry, entityType: string, path = 'condition'): ValidationResult<AutomationCondition> {
  if (!isBoundedJson(input) || !isRecord(input) || !hasOnly(input, ['kind', 'id', 'field', 'operator', 'value']) || input.kind !== 'condition' || !isIdentifier(input.id) || typeof input.field !== 'string' || !conditionOperators.includes(input.operator as AutomationCondition['operator'])) {
    return invalid(path, 'invalid_condition', 'Choose a valid structured condition.');
  }
  const field = registry.field(entityType, input.field);
  if (!field) return invalid(`${path}.field`, 'unknown_field', 'Choose a registered field for this trigger.');
  const operator = input.operator as AutomationCondition['operator'];
  if (!operatorsFor(field).includes(operator)) return invalid(`${path}.operator`, 'invalid_operator', 'This operator is not available for this field.');
  const emptiness = operator === 'is_empty' || operator === 'is_not_empty';
  if (emptiness) {
    if (Object.hasOwn(input, 'value')) return invalid(`${path}.value`, 'unexpected_value', 'Empty checks do not accept a value.');
  } else {
    const value = input.value;
    let valid: boolean;
    if (operator === 'in' || operator === 'not_in') {
      valid = Array.isArray(value) && value.length > 0 && value.length <= automationLimits.listValues && value.every(item => matchesValue(item, field.value));
    } else if ((operator === 'contains' || operator === 'not_contains') && field.value.kind === 'string_set') {
      valid = typeof value === 'string' && value.trim().length > 0 && value.length <= field.value.itemMaxLength;
    } else if ((operator === 'contains' || operator === 'not_contains') && field.value.kind === 'string') {
      // A substring may be shorter than a valid complete field (e.g. subject).
      valid = matchesValue(value, { ...field.value, minLength: 1 });
    } else {
      valid = matchesValue(value, field.value);
    }
    if (!valid) return invalid(`${path}.value`, 'invalid_value', 'Choose a value of the correct type and within the allowed limits.');
  }
  return { valid: true, value: copyJson(input) as AutomationCondition };
}

/** New drafts/writes obey the current byte ceiling. */
export function validateDefinition(input: unknown, registry: AutomationRegistry): ValidationResult<AutomationDefinition> {
  return validateDefinitionWithPolicy(input, registry, true);
}
/** Read/execute only: retain all original structural bounds for immutable data.
 * This does not confer persistence or execution authority. */
export function validateStoredDefinition(input: unknown, registry: AutomationRegistry): ValidationResult<AutomationDefinition> {
  return validateDefinitionWithPolicy(input, registry, false);
}
function validateDefinitionWithPolicy(input: unknown, registry: AutomationRegistry, enforceWriteLimit: boolean): ValidationResult<AutomationDefinition> {
  if (!isBoundedJson(input) || !isRecord(input) || !hasOnly(input, ['schemaVersion', 'name', 'description', 'trigger', 'conditions', 'actions'])) return invalid('definition', 'invalid_definition', 'Provide a bounded structured automation definition.');
  if (enforceWriteLimit && new TextEncoder().encode(JSON.stringify(input)).length > automationLimits.definitionBytes) return invalid('definition', 'definition_limit_exceeded', 'The automation definition exceeds the 256 KiB safety limit. Shorten notes or condition values.');
  const issues: ValidationIssue[] = [];
  if (input.schemaVersion !== 1) issues.push(issue('schemaVersion', 'unsupported_version', 'Only definition schema version 1 is supported.'));
  if (!matchesValue(input.name, { kind: 'string', minLength: 1, maxLength: automationLimits.name })) issues.push(issue('name', 'invalid_name', 'Enter an automation name of 1–120 characters.'));
  if (input.description !== null && !matchesValue(input.description, { kind: 'string', maxLength: automationLimits.description })) issues.push(issue('description', 'invalid_description', 'Provide a description of up to 2,000 characters or null.'));
  const trigger = isRecord(input.trigger) && typeof input.trigger.type === 'string' ? registry.trigger(input.trigger.type) : undefined;
  if (!trigger || !isRecord(input.trigger) || !hasOnly(input.trigger, ['type', 'configuration']) || !matchesConfiguration(input.trigger.configuration, trigger.configuration)) {
    issues.push(issue('trigger', 'invalid_trigger', 'Choose a registered trigger with valid configuration.'));
  }
  const group = input.conditions;
  const ids = new Set<string>();
  if (!isRecord(group) || !hasOnly(group, ['kind', 'id', 'operator', 'children']) || group.kind !== 'group' || !isIdentifier(group.id) || group.operator !== 'and' || !Array.isArray(group.children) || group.children.length > automationLimits.conditions) {
    issues.push(issue('conditions', 'invalid_group', 'V1 supports one AND group with up to 50 conditions.'));
  } else {
    ids.add(group.id);
    for (const [index, child] of group.children.entries()) {
      const path = `conditions.children.${index}`;
      if (isRecord(child) && child.kind === 'group') {
        issues.push(issue(path, 'unsupported_group', 'Nested groups and OR are not available in V1.'));
        continue;
      }
      if (isRecord(child) && typeof child.id === 'string') {
        if (ids.has(child.id)) issues.push(issue(`${path}.id`, 'duplicate_id', 'Condition identifiers must be unique.'));
        ids.add(child.id);
      }
      if (trigger) {
        const result = validateCondition(child, registry, trigger.entityType, path);
        if (!result.valid) issues.push(...result.issues);
      }
    }
  }
  if (!Array.isArray(input.actions) || input.actions.length < 1 || input.actions.length > automationLimits.actions) {
    issues.push(issue('actions', 'invalid_actions', 'Provide 1–20 ordered actions.'));
  } else {
    const actionIds = new Set<string>();
    const positions = new Set<number>();
    for (const [index, action] of input.actions.entries()) {
      const path = `actions.${index}`;
      if (!isRecord(action) || !hasOnly(action, ['id', 'type', 'position', 'configuration']) || !isIdentifier(action.id) || typeof action.type !== 'string' || !Number.isSafeInteger(action.position) || (action.position as number) < 0 || (action.position as number) >= input.actions.length) {
        issues.push(issue(path, 'invalid_action', 'Provide an action identifier, type, configuration, and contiguous zero-based position.'));
        continue;
      }
      const registration = registry.action(action.type);
      if (!registration) issues.push(issue(`${path}.type`, 'unknown_action', 'Choose a registered action.'));
      else {
        if (trigger && (registration.entityType !== trigger.entityType || (registration.triggerTypes && !registration.triggerTypes.includes(trigger.key)))) issues.push(issue(`${path}.type`, 'incompatible_action', 'This action is not compatible with the trigger.'));
        if (!matchesConfiguration(action.configuration, registration.configuration)) issues.push(issue(`${path}.configuration`, 'invalid_configuration', 'Provide the required action fields with valid values.'));
      }
      if (actionIds.has(action.id)) issues.push(issue(`${path}.id`, 'duplicate_id', 'Action identifiers must be unique.'));
      if (positions.has(action.position as number)) issues.push(issue(`${path}.position`, 'duplicate_position', 'Each action needs a unique position.'));
      actionIds.add(action.id);
      positions.add(action.position as number);
    }
  }
  if (issues.length) return { valid: false, issues };
  const definition = copyJson(input) as AutomationDefinition;
  return { valid: true, value: { ...definition, actions: [...definition.actions].sort((a, b) => a.position - b.position) } };
}

export function validateRule(input: unknown, registry: AutomationRegistry): ValidationResult<AutomationRule> {
  return validateRuleWithPolicy(input, registry, validateDefinition);
}
export function validateStoredRule(input: unknown, registry: AutomationRegistry): ValidationResult<AutomationRule> {
  return validateRuleWithPolicy(input, registry, validateStoredDefinition);
}
function validateRuleWithPolicy(input: unknown, registry: AutomationRegistry, validate: typeof validateDefinition): ValidationResult<AutomationRule> {
  if (!isBoundedJson(input) || !isRecord(input) || !hasOnly(input, ['id', 'organizationId', 'enabled', 'version', 'createdBy', 'createdAt', 'updatedAt', 'definition']) || !isUuid(input.id) || !isUuid(input.organizationId) || !isUuid(input.createdBy) || typeof input.enabled !== 'boolean' || !positiveInteger(input.version) || !isTimestamp(input.createdAt) || !isTimestamp(input.updatedAt) || Date.parse(input.updatedAt) < Date.parse(input.createdAt)) {
    return invalid('rule', 'invalid_rule', 'Provide valid tenant-scoped rule metadata.');
  }
  const definition = validate(input.definition, registry);
  if (!definition.valid) return definition;
  return { valid: true, value: { ...copyJson(input) as AutomationRule, definition: definition.value } };
}

export function validateEvent(input: unknown): ValidationResult<DomainEvent> {
  if (!isBoundedJson(input) || !isRecord(input) || !hasOnly(input, ['id', 'schemaVersion', 'type', 'organizationId', 'entityType', 'entityId', 'entityVersion', 'actorType', 'actorId', 'timestamp', 'before', 'after', 'changedFields', 'correlationId', 'causationId', 'rootEventId', 'depth', 'automationExecutionId'])) return invalid('event', 'invalid_event', 'Provide a bounded structured domain event.');
  if (![input.id, input.organizationId, input.entityId, input.correlationId, input.rootEventId].every(isUuid) || !isIdentifier(input.type) || !isIdentifier(input.entityType) || !positiveInteger(input.schemaVersion) || !positiveInteger(input.entityVersion) || !isTimestamp(input.timestamp) || (input.before !== null && !isRecord(input.before)) || !isRecord(input.after) || !Array.isArray(input.changedFields) || input.changedFields.length > 100 || !input.changedFields.every(isIdentifier) || new Set(input.changedFields).size !== input.changedFields.length || !Number.isSafeInteger(input.depth) || (input.depth as number) < 0 || (input.causationId !== null && !isUuid(input.causationId))) return invalid('event', 'invalid_event', 'Domain event metadata or snapshots are invalid.');
  if (!['member', 'automation', 'system'].includes(input.actorType as string) || (input.actorType === 'member' ? !isUuid(input.actorId) : input.actorId !== null) || (input.actorType === 'automation' ? !isUuid(input.automationExecutionId) : Object.hasOwn(input, 'automationExecutionId'))) return invalid('event.actorType', 'invalid_actor', 'Use explicit member, automation, or system provenance.');
  const sameId = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
  if (input.depth === 0 ? input.causationId !== null || !sameId(input.rootEventId, input.id) : input.causationId === null || sameId(input.rootEventId, input.id) || sameId(input.causationId, input.id)) return invalid('event.causationId', 'invalid_causation', 'Event chain metadata is inconsistent.');
  return { valid: true, value: copyJson(input) as DomainEvent };
}

export function validateSnapshotField(snapshot: DomainEvent['after'] | null, field: FieldRegistration): boolean {
  return snapshot !== null && Object.hasOwn(snapshot, field.key) && (snapshot[field.key] === null ? field.nullable : matchesValue(snapshot[field.key], field.value));
}

export function actionReferences(action: AutomationAction, registry: AutomationRegistry): readonly { resource: string; id: string }[] {
  const schema = registry.action(action.type)!.configuration;
  return Object.entries(schema).flatMap(([key, property]) => property.value.kind === 'reference' && typeof action.configuration[key] === 'string'
    ? [{ resource: property.value.resource, id: action.configuration[key] as string }] : []);
}
