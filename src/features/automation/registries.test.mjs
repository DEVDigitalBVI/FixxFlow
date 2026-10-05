import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { action, createAutomationRegistry, definition, registry, sampleDomain, ticketAutomationDomain, validateDefinition } from '../../../tests/fixtures/automation.mjs';

test('registries compose independent domains and do not use prototype properties as registrations', () => {
  const combined = createAutomationRegistry([ticketAutomationDomain, sampleDomain]);
  assert.equal(combined.trigger('sample.changed').entityType, 'sample');
  assert.equal(combined.trigger('ticket.created').entityType, 'ticket');
  assert.equal(combined.field('sample', 'priority'), undefined);
  for (const key of ['__proto__', 'constructor', 'toString']) assert.equal(combined.action(key), undefined);
  assert.equal(validateDefinition(definition({ actions: [action('sample.record', { flag: true })] }), combined).valid, false);
});

test('duplicate keys and invalid registration relationships fail at composition time', () => {
  assert.throws(() => createAutomationRegistry([ticketAutomationDomain, ticketAutomationDomain]), /Duplicate/);
  for (const key of ['fields', 'triggers', 'actions']) assert.throws(() => createAutomationRegistry([{ fields: [], triggers: [], actions: [], [key]: [ticketAutomationDomain[key][0], ticketAutomationDomain[key][0]] }]), /Duplicate/);
  assert.throws(() => createAutomationRegistry([{ ...sampleDomain, fields: [] }]), /Unknown trigger field/);
  assert.throws(() => createAutomationRegistry([{ ...sampleDomain, actions: [{ ...sampleDomain.actions[0], triggerTypes: ['ticket.created'] }] }]), /Incompatible action/);
});

test('registry metadata is detached and immutable after composition', () => {
  const mutable = { ...sampleDomain, fields: sampleDomain.fields.map(field => ({ ...field, value: { ...field.value } })) };
  const registered = createAutomationRegistry([mutable]);
  mutable.fields[0].value.max = 999;
  assert.equal(registered.field('sample', 'score').value.max, 100);
  assert.throws(() => { registered.field('sample', 'score').value.max = 999; }, TypeError);
  assert.throws(() => { registry.field('ticket', 'priority').value.values.push('urgent'); }, TypeError);
});

test('action trigger restrictions are validated even within the same domain', () => {
  const restricted = createAutomationRegistry([{ ...ticketAutomationDomain, actions: [{ ...ticketAutomationDomain.actions.find(item => item.key === 'set_priority'), triggerTypes: ['ticket.updated'] }] }]);
  assert.equal(validateDefinition(definition(), restricted).valid, false);
  assert.equal(validateDefinition(definition({ trigger: { type: 'ticket.updated', configuration: {} } }), restricted).valid, true);
});

test('core module dependency graph contains no domain, database, framework, network or dynamic execution dependency', () => {
  const seen = new Set();
  function inspect(filename) {
    if (seen.has(filename)) return;
    seen.add(filename);
    const source = fs.readFileSync(filename, 'utf8');
    assert.doesNotMatch(source, /\beval\s*\(|new\s+Function\s*\(|\bfetch\s*\(|process\.env|\bimport\s*\(/);
    for (const [, specifier] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.doesNotMatch(specifier, /tickets|supabase|database|domains|next|react|node:/);
      assert.ok(specifier.startsWith('.') || specifier.startsWith('@/lib/events/'));
      const target = specifier.startsWith('@/') ? path.resolve('src', specifier.slice(2)) : path.resolve(path.dirname(filename), specifier);
      inspect(`${target}.ts`);
    }
  }
  for (const file of ['model', 'registries', 'validation', 'values', 'conditions', 'planner']) inspect(path.resolve(`src/features/automation/${file}.ts`));
});
