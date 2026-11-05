import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const reportId = '60000000-0000-4000-8000-000000000001';
const scheduleId = '60000000-0000-4000-8000-000000000002';

test('schedule commands perform the requested tenant-scoped mutation and reject absent or unknown commands', async () => {
  const calls = [];
  const { manageReportSchedule } = load('src/app/app/reports/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ role: 'administrator', organizationId: 'workspace' }),
    },
    '@/lib/supabase/server': {
      createClient: async () => {
        calls.push(['client']);
        return {
          from(table) {
            assert.equal(table, 'report_schedules');
            const q = {
              delete: () => {
                calls.push(['delete']);
                return q;
              },
              update: (values) => {
                calls.push(['update', values]);
                return q;
              },
              eq: (key, value) => {
                calls.push(['eq', key, value]);
                return q;
              },
              then: (resolve) => Promise.resolve({ count: 1, error: null }).then(resolve),
            };
            return q;
          },
        };
      },
    },
  });
  for (const command of [null, 'unexpected', 'activate', 'pause', 'delete']) {
    calls.length = 0;
    const data = new FormData();
    data.set('reportId', reportId);
    data.set('scheduleId', scheduleId);
    if (command) data.set('command', command);
    const result = await manageReportSchedule(data);
    if (!command || command === 'unexpected') {
      assert.ok(result.error);
      assert.deepEqual(calls, []);
    } else {
      assert.ok(result.success);
      assert.deepEqual(
        calls[1],
        command === 'delete' ? ['delete'] : ['update', { active: command === 'activate' }],
      );
      assert.deepEqual(calls.slice(2), [
        ['eq', 'organization_id', 'workspace'],
        ['eq', 'report_id', reportId],
        ['eq', 'id', scheduleId],
      ]);
    }
  }
});
