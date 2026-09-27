import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';

const report = {
  asOf: '2026-09-27T12:00:00Z', timezone: 'UTC', today: '2026-09-27',
  summary: { created: 1, resolved: 0, open: 1, overdue: 0, response: null, resolution: 12 },
  daily: [{ day: '2026-09-27', created: 1, resolved: 0, reopened: 0, response: null, resolution: 12 }],
  breakdowns: [{ kind: 'priority', label: 'Normal', value: 1 }],
  sla: [{ label: 'Response', total: 1, met: 1 }],
};

test('report RPC accepts valid nullable timings and rejects malformed nested payloads', async () => {
  const { isReport } = load('src/features/reporting/payload.ts');
  assert.equal(isReport(report), true);
  for (const invalid of [null, {}, { ...report, summary: null }, { ...report, daily: [{}] },
    { ...report, breakdowns: [{ kind: 'priority', label: 'Normal', value: '1' }] },
    { ...report, summary: { ...report.summary, response: Infinity } }]) {
    assert.equal(isReport(invalid), false);
    const { getReport } = load('src/features/reporting/data.ts', {
      'server-only': {}, '@/lib/supabase/server': { createClient: async () => ({ rpc: async () => ({ data: invalid }) }) },
    });
    assert.equal(await getReport('org'), null);
  }
});
