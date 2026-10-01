import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';
import { action, definition, organizationId, rule, uuid } from '../../../tests/fixtures/automation.mjs';

function fixture({ viewer = {}, error = null, data, viewerError } = {}) {
  const calls = []; const source = rule({ enabled: false });
  const row = { id: source.id, organization_id: organizationId, definition: source.definition, name: source.definition.name, description: null,
    trigger_type: 'ticket.created', trigger_configuration: {}, conditions: source.definition.conditions, actions: source.definition.actions,
    enabled: false, version: 1, created_by: source.createdBy, updated_by: source.createdBy, created_at: source.createdAt, updated_at: source.updatedAt, enabled_at: null, archived_at: null };
  const response = single => ({ data: data === undefined ? single ? row : [row] : data, error });
  const chain = {
    then(resolve, reject) { return Promise.resolve(response(false)).then(resolve, reject); },
    async single() { calls.push(['single']); return response(true); },
    async maybeSingle() { calls.push(['maybeSingle']); return response(true); },
  };
  for (const method of ['select', 'eq', 'not', 'is', 'order', 'range']) chain[method] = (...args) => { calls.push([method, ...args]); return chain; };
  const client = { from: (...args) => { calls.push(['from', ...args]); return chain; }, rpc: (...args) => { calls.push(['rpc', ...args]); return chain; } };
  const service = load('src/features/automation/admin-service.ts', {
    'server-only': {},
    '@/lib/auth/viewer': { requireViewer: async () => { calls.push(['viewer']); if (viewerError) throw viewerError; return { id: uuid(3), organizationId, role: 'administrator', status: 'active', ...viewer }; } },
    '@/lib/supabase/server': { createClient: async () => { calls.push(['client']); return client; } },
  });
  return { service, calls, row, source };
}

test('create uses trusted viewer tenant, canonical definitions, session client and unchanged Stage 1 model', async () => {
  const { service, calls, source } = fixture();
  const input = definition({ actions: [action('set_status', { status: 'open' }, 1), action()] });
  const result = await service.createAutomation(input);
  assert.equal(result.ok, true); assert.deepEqual(result.value.rule, source);
  assert.deepEqual(calls.slice(0, 2), [['viewer'], ['client']]);
  const rpc = calls.find(call => call[0] === 'rpc');
  assert.equal(rpc[1], 'create_automation_rule'); assert.equal(rpc[2].target_organization_id, organizationId);
  assert.deepEqual(rpc[2].definition.actions.map(action => action.position), [0, 1]);
  assert.deepEqual(input.actions.map(action => action.position), [1, 0]);
  assert.equal(Object.hasOwn(rpc[2], 'created_by'), false);
});
for (const role of ['technician', 'end_user', 'platform_owner']) test(`${role} cannot use any management service`, async () => {
  const { service, calls } = fixture({ viewer: { role } });
  for (const invoke of [() => service.createAutomation(definition()), () => service.updateAutomation(uuid(2), 1, definition()), () => service.duplicateAutomation(uuid(2), 1, 'Copy'), () => service.setAutomationEnabled(uuid(2), 1, true), () => service.archiveAutomation(uuid(2), 1), () => service.listAutomations(), () => service.getAutomation(uuid(2)), () => service.getAutomationVersions(uuid(2))]) assert.equal((await invoke()).error.code, 'forbidden');
  assert.equal(calls.some(call => call[0] === 'client'), false);
});
test('inactive administrators are denied before opening a session client', async () => {
  const { service, calls } = fixture({ viewer: { status: 'inactive' } });
  assert.equal((await service.createAutomation(definition())).error.code, 'forbidden');
  assert.deepEqual(calls, [['viewer']]);
});
test('existing authentication and MFA redirects propagate unchanged', async () => {
  const redirect = new Error('NEXT_REDIRECT'); const { service, calls } = fixture({ viewerError: redirect });
  await assert.rejects(service.listAutomations(), error => error === redirect);
  assert.deepEqual(calls, [['viewer']]);
});
test('malformed and tenant-overriding definitions never reach an RPC', async () => {
  const { service, calls } = fixture();
  for (const input of [null, {}, definition({ organizationId: uuid(9) }), definition({ actions: [action('set_priority', { priority: 'urgent' })] })]) {
    const result = await service.createAutomation(input); assert.equal(result.error.code, 'invalid_definition'); assert.ok(result.error.issues.length);
    assert.equal((await service.updateAutomation(uuid(2), 1, input)).error.code, 'invalid_definition');
  }
  assert.equal(calls.some(call => call[0] === 'rpc'), false);
});
test('all mutation RPCs carry expected version and tenant; duplicate starts through its dedicated operation', async () => {
  const { service, calls } = fixture();
  await service.updateAutomation(uuid(2), 4, definition());
  await service.duplicateAutomation(uuid(2), 4, 'Copy');
  await service.setAutomationEnabled(uuid(2), 4, true);
  await service.setAutomationEnabled(uuid(2), 4, false);
  await service.archiveAutomation(uuid(2), 4);
  const rpc = calls.filter(call => call[0] === 'rpc');
  assert.deepEqual(rpc.map(call => call[1]), ['update_automation_rule', 'duplicate_automation_rule', 'set_automation_rule_enabled', 'set_automation_rule_enabled', 'archive_automation_rule']);
  for (const [, , args] of rpc) { assert.equal(args.target_organization_id, organizationId); assert.equal(args.expected_version, 4); assert.equal(args.rule_id, uuid(2)); }
  assert.equal(rpc[1][2].name, 'Copy'); assert.equal(rpc[2][2].enabled, true); assert.equal(rpc[3][2].enabled, false);
});
test('invalid identifiers, pagination, version tokens and booleans fail before queries', async () => {
  const { service, calls } = fixture();
  for (const version of [undefined, null, 0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, '1']) {
    assert.equal((await service.updateAutomation(uuid(2), version, definition())).error.code, 'invalid_input');
    assert.equal((await service.archiveAutomation(uuid(2), version)).error.code, 'invalid_input');
  }
  for (const page of [0, -1, 1.5, 100001, '1']) assert.equal((await service.listAutomations(page)).error.code, 'invalid_input');
  assert.equal((await service.getAutomation('bad')).error.code, 'invalid_input');
  assert.equal((await service.setAutomationEnabled(uuid(2), 1, 'true')).error.code, 'invalid_input');
  assert.equal((await service.duplicateAutomation(uuid(2), 1, ' ')).error.code, 'invalid_input');
  assert.equal(calls.some(call => ['rpc', 'from'].includes(call[0])), false);
});
for (const [code, safeCode] of [['40001', 'conflict'], ['42501', 'forbidden'], ['22023', 'invalid_definition'], ['22P05', 'invalid_definition'], ['22021', 'invalid_definition'], ['P0002', 'not_found'], ['55000', 'archived'], ['XX000', 'unavailable']]) test(`database ${code} becomes safe ${safeCode} result`, async () => {
  const { service } = fixture({ error: { code, message: 'SECRET password database internals', details: 'SECRET' }, data: null });
  const result = await service.archiveAutomation(uuid(2), 1);
  assert.equal(result.error.code, safeCode); assert.doesNotMatch(JSON.stringify(result), /SECRET|password|internals/);
});
test('reads use tenant scopes, stable ordering and bounded pages with explicit archived selection', async () => {
  const { service, calls } = fixture();
  assert.equal((await service.listAutomations(2)).ok, true);
  assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(['eq', 'organization_id', organizationId])));
  assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(['range', 50, 99])));
  assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(['is', 'archived_at', null])));
  calls.length = 0; await service.listAutomations(1, true);
  assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(['not', 'archived_at', 'is', null])));
  calls.length = 0; await service.getAutomation(uuid(2));
  assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(['eq', 'id', uuid(2)])));
});
test('historical reads remain scoped and do not require the rule to be active', async () => {
  const source = rule(); const row = { organization_id: organizationId, rule_id: source.id, version: 1, definition: definition(), enabled: false, enabled_at: null, archived_at: source.updatedAt, created_by: source.createdBy, created_at: source.createdAt };
  const { service, calls } = fixture({ data: [row] });
  const result = await service.getAutomationVersions(source.id, 3);
  assert.equal(result.ok, true); assert.equal(result.value[0].archivedAt, source.updatedAt);
  for (const expected of [['from', 'automation_rule_versions'], ['eq', 'organization_id', organizationId], ['eq', 'rule_id', source.id], ['range', 100, 149]]) assert.ok(calls.some(call => JSON.stringify(call) === JSON.stringify(expected)));
  assert.equal(calls.some(call => call[0] === 'is'), false);
});
test('repository fails closed on cross-tenant or malformed storage responses', async () => {
  const { row } = fixture();
  for (const bad of [{ ...row, organization_id: uuid(99) }, { ...row, definition: {} }, { ...row, archived_at: row.updated_at, enabled: true }]) {
    const { service } = fixture({ data: bad });
    assert.equal((await service.getAutomation(uuid(2))).error.code, 'unavailable');
  }
  const { service } = fixture({ data: null }); assert.equal((await service.getAutomation(uuid(2))).error.code, 'not_found');
});
