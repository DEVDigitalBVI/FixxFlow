import assert from 'node:assert/strict';
import test from 'node:test';
import { action, condition, createAutomationRegistry, definition, event, group, organizationId, planAutomation, registry, rule, sampleDomain, ticketAutomationDomain, uuid } from '../../../tests/fixtures/automation.mjs';

function transition(type, before, after, changedFields = Object.keys(after)) {
  return event({ type, before, after, changedFields, entityVersion: 2 });
}
function forTrigger(type, patch = {}) {
  return rule({ definition: definition({ trigger: { type, configuration: {} }, conditions: group(), ...patch }) });
}

test('planner orders actions without mutating inputs or producing effects', () => {
  const inputRule = rule({ definition: definition({ actions: [action('set_priority', { priority: 'high' }, 1), action('assign_technician', { technicianId: uuid(9) }, 0)] }) });
  const inputEvent = event();
  const before = JSON.stringify([inputRule, inputEvent]);
  const first = planAutomation(inputRule, inputEvent, registry, organizationId);
  const second = planAutomation(inputRule, inputEvent, registry, organizationId);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'ready');
  assert.equal(first.validationScope, 'structural_only');
  assert.equal(first.failurePolicy, 'stop');
  assert.deepEqual(first.actions.map(item => item.action.type), ['assign_technician', 'set_priority']);
  assert.deepEqual(first.actions[0].references, [{ organizationId, resource: 'active_ticket_workers', id: uuid(9) }]);
  assert.deepEqual(first.actions[1].references, []);
  first.actions[1].action.configuration.priority = 'low';
  assert.equal(JSON.stringify([inputRule, inputEvent]), before);
});

test('disabled, invalid, nonmatching and missing-context rules never propose actions', () => {
  const cases = [
    [rule({ enabled: false }), event(), 'disabled'],
    [rule({ definition: definition({ actions: [action('apply_sla', {})] }) }), event(), 'invalid_rule'],
    [rule(), event({ organizationId: 'bad' }), 'invalid_event'],
    [rule({ definition: definition({ conditions: group(condition('priority', 'equals', 'low')) }) }), event(), 'conditions_failed'],
    [rule({ definition: definition({ conditions: group(condition('category_id', 'is_empty')) }) }), event(), 'condition_error'],
  ];
  for (const [inputRule, inputEvent, status] of cases) {
    const result = planAutomation(inputRule, inputEvent, registry, organizationId);
    assert.equal(result.status, status);
    assert.deepEqual(result.actions, []);
  }
});

test('tenant checks include the trusted context, rule and event even when two supplied IDs agree', () => {
  for (const [inputRule, inputEvent, context] of [
    [rule({ organizationId: uuid(99) }), event(), organizationId],
    [rule(), event({ organizationId: uuid(99) }), organizationId],
    [rule({ organizationId: uuid(99) }), event({ organizationId: uuid(99) }), organizationId],
    [rule(), event(), 'invalid'],
  ]) {
    const result = planAutomation(inputRule, inputEvent, registry, context);
    assert.equal(result.status, 'tenant_mismatch');
    assert.deepEqual(result.actions, []);
  }
});

const transitions = [
  ['ticket.created', event(), true],
  ['ticket.created', event({ before: { status: 'new' } }), false],
  ['ticket.updated', transition('ticket.updated', { priority: 'normal' }, { priority: 'critical' }), true],
  ['ticket.updated', transition('ticket.updated', { priority: 'normal' }, { priority: 'normal' }), false],
  ['ticket.updated', transition('ticket.updated', { updated_at: 'old' }, { updated_at: 'new' }), false],
  ['ticket.updated', transition('ticket.updated', {}, {}, ['description']), true],
  ['ticket.assigned', transition('ticket.assigned', { assigned_technician_id: null, team_id: null }, { assigned_technician_id: uuid(9), team_id: null }), true],
  ['ticket.assigned', transition('ticket.assigned', { assigned_technician_id: null, team_id: uuid(8) }, { assigned_technician_id: null, team_id: uuid(9) }), true],
  ['ticket.assigned', transition('ticket.assigned', { assigned_technician_id: uuid(9), team_id: null }, { assigned_technician_id: null, team_id: null }), false],
  ['ticket.status_changed', transition('ticket.status_changed', { status: 'new' }, { status: 'open' }), true],
  ['ticket.status_changed', transition('ticket.status_changed', { status: 'open' }, { status: 'open' }), false],
  ['ticket.status_changed', transition('ticket.status_changed', { status: 'new' }, { status: 'open' }, []), false],
  ['ticket.priority_changed', transition('ticket.priority_changed', { priority: 'normal' }, { priority: 'high' }), true],
  ['ticket.priority_changed', transition('ticket.priority_changed', { priority: 'normal' }, { priority: 'normal' }), false],
  ['ticket.resolved', transition('ticket.resolved', { status: 'open' }, { status: 'resolved' }), true],
  ['ticket.resolved', transition('ticket.resolved', { status: 'open' }, { status: 'closed' }), true],
  ['ticket.resolved', transition('ticket.resolved', { status: 'resolved' }, { status: 'closed' }), false],
  ['ticket.resolved', transition('ticket.resolved', { status: 'closed' }, { status: 'open' }), false],
];
for (const [index, [type, inputEvent, matches]] of transitions.entries()) test(`trigger compatibility ${type} case ${index + 1}`, () => {
  const result = planAutomation(forTrigger(type), inputEvent, registry, organizationId);
  assert.equal(result.status, matches ? 'ready' : 'incompatible_trigger');
  assert.equal(result.triggerCompatible, matches);
  assert.equal(result.actions.length, matches ? 1 : 0);
});

test('event type, entity type, and schema version must all match the registered trigger', () => {
  for (const patch of [{ type: 'ticket.updated' }, { type: 'ticket.unknown' }, { entityType: 'sample' }, { schemaVersion: 2 }]) {
    const result = planAutomation(rule(), event(patch), registry, organizationId);
    assert.equal(result.status, 'incompatible_trigger');
    assert.deepEqual(result.actions, []);
  }
});

test('transition triggers require typed before/after values', () => {
  for (const inputEvent of [
    transition('ticket.status_changed', { status: 'invented' }, { status: 'open' }),
    transition('ticket.status_changed', {}, { status: 'open' }),
    transition('ticket.status_changed', { status: 'open' }, { status: null }),
  ]) {
    const result = planAutomation(forTrigger('ticket.status_changed'), inputEvent, registry, organizationId);
    assert.equal(result.status, 'invalid_event');
    assert.deepEqual(result.actions, []);
  }
});

test('planner works with a non-ticket domain and passes declarative trigger configuration to its adapter', () => {
  const sampleRegistry = createAutomationRegistry([sampleDomain]);
  const inputRule = rule({ definition: definition({ trigger: { type: 'sample.changed', configuration: { minimum: 4 } }, conditions: group(condition('flag', 'equals', false)), actions: [action('sample.record', { flag: true })] }) });
  const inputEvent = event({ type: 'sample.changed', entityType: 'sample', before: { score: 1 }, after: { score: 5, flag: false }, changedFields: ['score'] });
  assert.equal(planAutomation(inputRule, inputEvent, sampleRegistry, organizationId).status, 'ready');
  assert.equal(planAutomation(inputRule, { ...inputEvent, after: { score: 3, flag: false } }, sampleRegistry, organizationId).status, 'incompatible_trigger');
});

test('adapter failures return safe explicit diagnostics and never leak thrown internals', () => {
  const brokenRegistry = createAutomationRegistry([{ ...ticketAutomationDomain, triggers: ticketAutomationDomain.triggers.map(trigger => ({ ...trigger, matches: () => { throw Error('credential=private'); } })) }]);
  const result = planAutomation(rule(), event(), brokenRegistry, organizationId);
  assert.equal(result.status, 'invalid_event');
  assert.equal(result.issues[0].code, 'trigger_adapter_failed');
  assert.equal(JSON.stringify(result).includes('credential'), false);
  assert.deepEqual(result.actions, []);
});

test('code-looking note content stays inert data in an action plan', () => {
  const body = 'eval("globalThis.automationExecuted = true"); SELECT * FROM tickets;';
  const result = planAutomation(rule({ definition: definition({ actions: [action('add_internal_note', { body })] }) }), event(), registry, organizationId);
  assert.equal(result.status, 'ready');
  assert.equal(result.actions[0].action.configuration.body, body);
  assert.equal(globalThis.automationExecuted, undefined);
});
