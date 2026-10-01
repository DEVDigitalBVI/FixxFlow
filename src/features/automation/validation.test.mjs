import assert from 'node:assert/strict';
import test from 'node:test';
import { action, condition, createAutomationRegistry, definition, event, group, registry, rule, sampleDomain, uuid, validateCondition, validateDefinition, validateEvent, validateRule } from '../../../tests/fixtures/automation.mjs';

test('valid definitions detach their structured data and canonicalize explicit action positions', () => {
  const source = definition({ actions: [action('set_status', { status: 'open' }, 1), action()] });
  const result = validateDefinition(source, registry);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value.actions.map(item => item.position), [0, 1]);
  assert.deepEqual(source.actions.map(item => item.position), [1, 0]);
  source.actions[1].configuration.priority = 'low';
  assert.equal(result.value.actions[0].configuration.priority, 'high');
});

const malformed = [
  ['null', () => null], ['array', () => []], ['missing metadata', () => ({})],
  ['future version', () => definition({ schemaVersion: 2 })],
  ['empty name', () => definition({ name: ' ' })], ['long name', () => definition({ name: 'x'.repeat(121) })],
  ['long description', () => definition({ description: 'x'.repeat(2001) })],
  ['unknown top-level expression', () => ({ ...definition(), expression: 'return true' })],
  ['unknown trigger', () => definition({ trigger: { type: 'ticket.unknown', configuration: {} } })],
  ['extra trigger SQL', () => definition({ trigger: { type: 'ticket.created', configuration: { sql: 'select * from tickets' } } })],
  ['unknown trigger property', () => definition({ trigger: { type: 'ticket.created', configuration: {}, script: 'true' } })],
  ['OR root', () => definition({ conditions: { ...group(), operator: 'or' } })],
  ['nested AND', () => definition({ conditions: group({ ...group(), id: 'nested' }) })],
  ['nested OR', () => definition({ conditions: group({ ...group(), id: 'nested', operator: 'or' }) })],
  ['duplicate condition id', () => definition({ conditions: group(condition(), condition()) })],
  ['root/leaf duplicate id', () => definition({ conditions: group(condition('priority', 'equals', 'high', 'root')) })],
  ['too many conditions', () => definition({ conditions: group(...Array.from({ length: 51 }, (_, i) => condition('priority', 'equals', 'high', `c${i}`))) })],
  ['no actions', () => definition({ actions: [] })],
  ['too many actions', () => definition({ actions: Array.from({ length: 21 }, (_, i) => action('set_priority', { priority: 'high' }, i)) })],
  ['duplicate action id', () => definition({ actions: [action(), action('set_status', { status: 'open' }, 1, 'action-0')] })],
  ['duplicate position', () => definition({ actions: [action(), action('set_status', { status: 'open' }, 0, 'other')] })],
  ['position gap', () => definition({ actions: [action('set_priority', { priority: 'high' }, 1)] })],
  ['negative position', () => definition({ actions: [action('set_priority', { priority: 'high' }, -1)] })],
  ['fractional position', () => definition({ actions: [action('set_priority', { priority: 'high' }, 0.5)] })],
  ['string position', () => definition({ actions: [action('set_priority', { priority: 'high' }, '0')] })],
  ['unknown action', () => definition({ actions: [action('call_webhook', { url: 'https://example.test' })] })],
  ...['add_tag', 'remove_tag', 'apply_sla'].map(type => [type, () => definition({ actions: [action(type, {})] })]),
  ['missing action property', () => definition({ actions: [action('set_priority', {})] })],
  ['null configuration', () => definition({ actions: [action('set_priority', null)] })],
  ['wrong enum', () => definition({ actions: [action('set_priority', { priority: 'urgent' })] })],
  ['invalid technician id', () => definition({ actions: [action('assign_technician', { technicianId: 'not-uuid' })] })],
  ['extra organization override', () => definition({ actions: [action('assign_team', { teamId: uuid(2), organizationId: uuid(99) })] })],
  ['extra executable configuration', () => definition({ actions: [action('set_priority', { priority: 'high', javascript: 'process.exit()' })] })],
  ['configurable failure policy', () => definition({ actions: [{ ...action(), onFailure: 'continue' }] })],
  ['empty note', () => definition({ actions: [action('add_internal_note', { body: ' ' })] })],
  ['oversized note', () => definition({ actions: [action('add_internal_note', { body: 'x'.repeat(20001) })] })],
  ['arbitrary email recipient', () => definition({ actions: [action('send_notification', { recipient: 'outside@example.test', template: 'ticket_update' })] })],
  ['unknown notification template', () => definition({ actions: [action('send_notification', { recipient: 'requester', template: 'arbitrary' })] })],
];
for (const [label, make] of malformed) test(`definition rejects ${label}`, () => assert.equal(validateDefinition(make(), registry).valid, false));

test('non-JSON values, executable functions, accessors, cycles, prototype keys and oversized input fail without execution', () => {
  const cycle = definition(); cycle.conditions.children.push(cycle);
  const getter = definition(); Object.defineProperty(getter, 'name', { enumerable: true, get() { throw Error('Must not run'); } });
  const hostile = JSON.parse('{"__proto__":{"polluted":true}}');
  for (const value of [cycle, getter, new Date(), { ...definition(), name: () => { throw Error('Must not run'); } }, { ...definition(), name: undefined }, { ...definition(), name: 1n }, { ...definition(), name: NaN }, { ...definition(), name: Infinity }, { ...definition(), name: Symbol('code') }, { ...definition(), ...hostile }, { ...definition(), description: 'x'.repeat(100001) }]) {
    assert.equal(validateDefinition(value, registry).valid, false);
  }
  assert.equal({}.polluted, undefined);
});

const invalidConditions = [
  condition('status', 'greater_than', 'open'), condition('category_id', 'contains', uuid(2)),
  condition('priority', 'is_empty'), condition('priority', 'equals', null), condition('priority', 'equals', 'Critical'),
  condition('requester_id', 'equals', 4), condition('requester_id', 'in', ['invalid']), condition('status', 'in', []),
  condition('status', 'in', ['new', 4]), condition('status', 'in', Array(101).fill('new')),
  condition('title', 'contains', ''), condition('title', 'contains', '  '), condition('tags', 'contains', 'network'),
  { ...condition(), operator: 'eval' }, { ...condition(), code: 'true' },
  { ...condition('category_id', 'is_empty'), value: null }, { ...condition(), value: undefined },
];
for (const [index, item] of invalidConditions.entries()) test(`invalid field/operator/value combination ${index + 1}`, () => assert.equal(validateCondition(item, registry, 'ticket').valid, false));

test('all supported action contracts validate and deferred domain features remain absent', () => {
  for (const [type, configuration] of [
    ['assign_technician', { technicianId: uuid(9) }], ['assign_team', { teamId: uuid(9) }],
    ['set_priority', { priority: 'critical' }], ['set_status', { status: 'closed' }],
    ['set_category', { categoryId: uuid(9) }], ['add_internal_note', { body: 'Diagnostic note' }],
    ['send_notification', { recipient: 'assigned_technician', template: 'ticket_update' }],
  ]) assert.equal(validateDefinition(definition({ actions: [action(type, configuration)] }), registry).valid, true, type);
  for (const name of ['add_tag', 'remove_tag', 'apply_sla']) assert.equal(registry.action(name), undefined);
});

test('rule metadata rejects invalid tenant, versions, users and chronology', () => {
  assert.equal(validateRule(rule(), registry).valid, true);
  for (const patch of [{ organizationId: 'foreign' }, { id: '' }, { version: 0 }, { version: 1.2 }, { version: '1' }, { enabled: 'true' }, { createdBy: null }, { updatedAt: '2026-09-29T10:00:00Z' }, { createdAt: 'tomorrow' }, { extra: true }]) assert.equal(validateRule(rule(patch), registry).valid, false);
});

test('event metadata and provenance are validated independently of transport', () => {
  assert.equal(validateEvent(event()).valid, true);
  assert.equal(validateEvent(event({ actorType: 'system', actorId: null })).valid, true);
  assert.equal(validateEvent(event({ id: uuid(20), actorType: 'automation', actorId: null, automationExecutionId: uuid(21), depth: 1, causationId: uuid(4) })).valid, true);
  for (const patch of [{ actorType: 'anonymous' }, { actorId: null }, { actorType: 'system' }, { actorType: 'automation', actorId: null }, { automationExecutionId: uuid(22) }, { depth: -1 }, { depth: 1 }, { causationId: uuid(4) }, { rootEventId: uuid(99) }, { entityVersion: 0 }, { schemaVersion: '1' }, { timestamp: 'today' }, { changedFields: ['status', 'status'] }, { changedFields: ['status;drop table'] }, { before: [] }, { after: null }, { sql: 'select 1' }]) assert.equal(validateEvent(event(patch)).valid, false, JSON.stringify(patch));
});

test('synthetic numeric, boolean and collection schemas reject coercion and invalid values', () => {
  const sample = createAutomationRegistry([sampleDomain]);
  for (const item of [condition('score', 'equals', '5'), condition('score', 'equals', -1), condition('score', 'equals', 101), condition('score', 'equals', 1.1), condition('flag', 'equals', 'true'), condition('flag', 'contains', true), condition('items', 'equals', ['one']), condition('items', 'contains', ['one'])]) assert.equal(validateCondition(item, sample, 'sample').valid, false);
});

test('timestamps require actual calendar dates and explicit timezones', () => {
  for (const timestamp of ['2026-02-30T10:00:00Z', '2026-02-29T10:00:00Z', '2026-09-31T10:00:00Z', '2026-09-30T10:00:00', '2026-09-30T24:00:00Z']) assert.equal(validateEvent(event({ timestamp })).valid, false, timestamp);
  for (const timestamp of ['2024-02-29T10:00:00Z', '2026-09-30T10:00:00.123456-04:00']) assert.equal(validateEvent(event({ timestamp })).valid, true, timestamp);
});

test('input size and structure limits include arrays, sparse arrays, deep groups and non-plain objects', () => {
  let nested = group();
  for (let i = 0; i < 20; i++) nested = group(nested);
  for (const input of [definition({ conditions: nested }), definition({ actions: Array(2) }), definition({ actions: Array(1001).fill(action()) }), definition({ description: new Map() }), definition({ trigger: new (class {})() })]) assert.equal(validateDefinition(input, registry).valid, false);
});
