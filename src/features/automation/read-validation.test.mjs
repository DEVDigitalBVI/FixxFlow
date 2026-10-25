import assert from 'node:assert/strict';
import test from 'node:test';

import { overview, rows } from '../../../tests/fixtures/automation-operations.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const validators = load('src/features/automation/read-validation.ts');

test('automation overview validates nested metrics, timestamps and optional counters', () => {
  assert.equal(validators.isOperationsOverview(overview), true);
  for (const invalid of [
    null,
    [],
    {},
    { ...overview, now: 'tomorrow' },
    { ...overview, worker: {} },
    { ...overview, queue: { ...overview.queue, ready: -1 } },
    { ...overview, lag: { ...overview.lag, maxSeconds: Infinity } },
    { ...overview, temporalRules: [{}] },
  ]) {
    assert.equal(validators.isOperationsOverview(invalid), false);
  }
  assert.equal(
    validators.isOperationsOverview({
      ...overview,
      queue: { ...overview.queue, capacityDeferred: 2 },
    }),
    true,
  );
});
test('history validates each row and its pagination envelope', () => {
  const history = { rows, hasNext: false, since: '2026-09-30T12:00:00Z', until: overview.now };
  assert.equal(validators.isOperationsHistory(history), true);
  for (const invalid of [
    { ...history, rows: {} },
    { ...history, hasNext: 'false' },
    { ...history, rows: [{ ...rows[0], duration_ms: '1400' }] },
    { ...history, since: null },
  ])
    assert.equal(validators.isOperationsHistory(invalid), false);
});
test('administrator reads reject malformed envelopes and rows before rendering', async () => {
  let payload = { rows: {} };
  const { automationChoices, automationList, automationEvents } = load(
    'src/features/automation/ui-service.ts',
    {
      '@/lib/auth/viewer': {
        requireViewer: async () => ({
          role: 'administrator',
          status: 'active',
          organizationId: 'org',
        }),
      },
      '@/lib/supabase/server': {
        createClient: async () => ({ rpc: async () => ({ data: payload, error: null }) }),
      },
    },
  );
  await assert.rejects(automationChoices('teams'), /could not load/);
  payload = { rows: [{ id: rows[0].id, label: 'Network', active: true }] };
  assert.equal((await automationChoices('teams')).rows[0].label, 'Network');
  payload.rows[0].active = 'true';
  await assert.rejects(automationChoices('teams'), /could not load/);
  payload = { rows: [{}] };
  await assert.rejects(automationList('', 'all', '', 1), /could not load/);
  await assert.rejects(automationEvents(rows[0].id), /could not load/);
});
