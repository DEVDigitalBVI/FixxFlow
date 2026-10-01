import { load } from '../helpers/load-module.mjs';

export const { createAutomationRegistry, operatorsFor } = load('src/features/automation/registries.ts');
export const { ticketAutomationDomain } = load('src/features/automation/domains/tickets/registry.ts');
export const { validateDefinition, validateRule, validateEvent, validateCondition } = load('src/features/automation/validation.ts');
export const { evaluateConditions } = load('src/features/automation/conditions.ts');
export const { planAutomation } = load('src/features/automation/planner.ts');
export const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
export const organizationId = uuid(1);
export const registry = createAutomationRegistry([ticketAutomationDomain]);
export const condition = (field = 'priority', operator = 'equals', value = 'critical', id = 'condition-1') => ({ kind: 'condition', id, field, operator, ...(['is_empty', 'is_not_empty'].includes(operator) ? {} : { value }) });
export const group = (...children) => ({ kind: 'group', id: 'root', operator: 'and', children });
export const action = (type = 'set_priority', configuration = { priority: 'high' }, position = 0, id = `action-${position}`) => ({ id, type, position, configuration });
export function definition(overrides = {}) {
  return { schemaVersion: 1, name: 'Route requests', description: null, trigger: { type: 'ticket.created', configuration: {} }, conditions: group(condition()), actions: [action()], ...overrides };
}
export function rule(overrides = {}) {
  return { id: uuid(2), organizationId, enabled: true, version: 1, createdBy: uuid(3), createdAt: '2026-09-30T10:00:00Z', updatedAt: '2026-09-30T10:00:00Z', definition: definition(), ...overrides };
}
export function event(overrides = {}) {
  return {
    id: uuid(4), schemaVersion: 1, type: 'ticket.created', organizationId, entityType: 'ticket', entityId: uuid(5), entityVersion: 1,
    actorType: 'member', actorId: uuid(3), timestamp: '2026-09-30T11:00:00Z', before: null,
    after: { title: 'Network unavailable', status: 'new', priority: 'critical', requester_id: uuid(6), assigned_technician_id: null, team_id: null },
    changedFields: [], correlationId: uuid(7), causationId: null, rootEventId: uuid(4), depth: 0, ...overrides,
  };
}
// A synthetic domain proves that core behavior has no dependency on ticket types.
export const sampleDomain = {
  fields: [
    { key: 'score', entityType: 'sample', label: 'Score', nullable: true, value: { kind: 'number', min: 0, max: 100, integer: true } },
    { key: 'text', entityType: 'sample', label: 'Text', nullable: true, value: { kind: 'string', maxLength: 200 } },
    { key: 'flag', entityType: 'sample', label: 'Flag', nullable: false, value: { kind: 'boolean' } },
    { key: 'items', entityType: 'sample', label: 'Items', nullable: true, value: { kind: 'string_set', maxItems: 5, itemMaxLength: 20 } },
  ],
  triggers: [{ key: 'sample.changed', entityType: 'sample', label: 'Sample changed', eventSchemaVersion: 1, configuration: { minimum: { value: { kind: 'number' } } }, beforeFields: [], afterFields: ['score'], matches: (event, config) => event.after.score >= config.minimum }],
  actions: [{ key: 'sample.record', entityType: 'sample', label: 'Record', configuration: { flag: { value: { kind: 'boolean' } }, comment: { value: { kind: 'string', maxLength: 100 }, optional: true } } }],
};
