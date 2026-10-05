import assert from 'node:assert/strict';
import test from 'node:test';
import { condition, createAutomationRegistry, evaluateConditions, group, registry, sampleDomain, uuid } from '../../../tests/fixtures/automation.mjs';

const cases = [
  ['equals', 'priority', 'critical', 'critical', true], ['equals false', 'priority', 'critical', 'high', false, 'equals'],
  ['not_equals', 'status', 'closed', 'open', true], ['not_equals false', 'status', 'open', 'open', false, 'not_equals'],
  ['contains', 'title', 'netWORK', 'Network unavailable', true], ['contains false', 'title', 'printer', 'Network unavailable', false, 'contains'],
  ['not_contains', 'title', 'printer', 'Network unavailable', true], ['not_contains false', 'title', 'network', 'Network unavailable', false, 'not_contains'],
  ['is_empty', 'team_id', undefined, null, true], ['is_empty false', 'team_id', undefined, uuid(8), false, 'is_empty'],
  ['is_not_empty', 'team_id', undefined, uuid(8), true], ['is_not_empty false', 'team_id', undefined, null, false, 'is_not_empty'],
  ['greater_than', 'priority', 'normal', 'critical', true], ['greater_than false', 'priority', 'critical', 'critical', false, 'greater_than'],
  ['less_than', 'priority', 'high', 'normal', true], ['less_than false', 'priority', 'low', 'normal', false, 'less_than'],
  ['in', 'status', ['new', 'open'], 'open', true], ['in false', 'status', ['new', 'open'], 'closed', false, 'in'],
  ['not_in', 'status', ['resolved', 'closed'], 'open', true], ['not_in false', 'status', ['resolved', 'closed'], 'closed', false, 'not_in'],
];
for (const [label, field, expected, actual, pass, op = label] of cases) test(`operator ${label}`, () => {
  const result = evaluateConditions(group(condition(field, op, expected)), { [field]: actual }, registry, 'ticket');
  assert.equal(result.passed, pass);
  assert.deepEqual(result.issues, []);
  assert.equal(result.results[0].status, pass ? 'passed' : 'failed');
});

test('AND reports all leaves, including those after a failure; empty AND matches all', () => {
  const result = evaluateConditions(group(condition('priority', 'equals', 'low', 'p'), condition('status', 'equals', 'open', 's')), { priority: 'critical', status: 'open' }, registry, 'ticket');
  assert.equal(result.passed, false);
  assert.deepEqual(result.results.map(item => item.status), ['failed', 'passed']);
  assert.equal(evaluateConditions(group(), {}, registry, 'ticket').passed, true);
});

test('missing context errors rather than treating it as empty; malformed values fail closed', () => {
  for (const snapshot of [{}, { team_id: 'invalid' }, { team_id: false }]) {
    const result = evaluateConditions(group(condition('team_id', 'is_empty')), snapshot, registry, 'ticket');
    assert.equal(result.passed, false);
    assert.equal(result.results[0].status, 'error');
  }
  for (const operator of ['equals', 'not_equals', 'in', 'not_in']) {
    const result = evaluateConditions(group(condition('team_id', operator, operator.endsWith('in') ? [uuid(2)] : uuid(2))), { team_id: null }, registry, 'ticket');
    assert.equal(result.passed, false, operator);
    assert.equal(result.results[0].status, 'failed');
  }
});

test('literal case-insensitive text operators never interpret regex, SQL, or JavaScript', () => {
  const sample = createAutomationRegistry([sampleDomain]);
  for (const literal of ['.*', '%', '_', 'eval(throw)', 'select * from tickets']) {
    assert.equal(evaluateConditions(group(condition('text', 'contains', literal)), { text: `Plain ${literal} text` }, sample, 'sample').passed, true);
    assert.equal(evaluateConditions(group(condition('text', 'contains', literal)), { text: 'unrelated text' }, sample, 'sample').passed, false);
  }
  assert.equal(evaluateConditions(group(condition('text', 'equals', 'HELLO')), { text: 'hello' }, sample, 'sample').passed, true);
  assert.equal(evaluateConditions(group(condition('text', 'in', ['HELLO', 'OTHER'])), { text: 'hello' }, sample, 'sample').passed, true);
  assert.equal(evaluateConditions(group(condition('title', 'contains', 'N')), { title: 'Network' }, registry, 'ticket').passed, true);
});

test('UUID conditions compare canonical identity rather than letter casing', () => {
  const id = 'abcdef12-1234-4567-89ab-abcdef123456';
  assert.equal(evaluateConditions(group(condition('team_id', 'equals', id.toUpperCase())), { team_id: id }, registry, 'ticket').passed, true);
  assert.equal(evaluateConditions(group(condition('team_id', 'in', [id.toUpperCase()])), { team_id: id }, registry, 'ticket').passed, true);
});

test('pure engine supports another domain, zero/false, ordinal comparison and collection membership', () => {
  const sample = createAutomationRegistry([sampleDomain]);
  for (const [field, operator, expected, actual, passed] of [
    ['score', 'greater_than', 4, 5, true], ['score', 'greater_than', 5, 5, false], ['score', 'less_than', 1, 0, true],
    ['score', 'equals', 0, 0, true], ['score', 'in', [0, 1], 0, true], ['score', 'is_empty', undefined, 0, false],
    ['flag', 'equals', false, false, true], ['flag', 'not_in', [true], false, true],
    ['text', 'is_empty', undefined, '   ', true], ['text', 'is_not_empty', undefined, '', false],
    ['items', 'is_empty', undefined, [], true], ['items', 'contains', 'one', ['one', 'two'], true],
    ['items', 'contains', 'on', ['one'], false], ['items', 'not_contains', 'one', ['two'], true],
  ]) assert.equal(evaluateConditions(group(condition(field, operator, expected)), { [field]: actual }, sample, 'sample').passed, passed, `${field} ${operator}`);
  assert.equal(evaluateConditions(group(condition('items', 'contains', 'one')), { items: ['one', 'one'] }, sample, 'sample').results[0].status, 'error');
});

test('public evaluator rejects OR, nested groups, duplicate IDs and unknown fields without throwing', () => {
  for (const invalid of [{ ...group(condition()), operator: 'or' }, group({ ...group(), id: 'nested' }), group(condition(), condition()), group(condition('unknown')), { ...group(), sql: 'true' }]) {
    const result = evaluateConditions(invalid, { priority: 'critical' }, registry, 'ticket');
    assert.equal(result.passed, false);
    assert.ok(result.issues.length > 0);
  }
});

test('condition results do not duplicate snapshot text or values into execution diagnostics', () => {
  const secretText = 'private diagnostic phrase';
  const result = evaluateConditions(group(condition('title', 'equals', secretText)), { title: secretText }, registry, 'ticket');
  assert.equal(result.passed, true);
  assert.equal(JSON.stringify(result).includes(secretText), false);
});
