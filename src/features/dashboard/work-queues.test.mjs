import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

test('queue counts use tenant-scoped exact counts, active work, assignment and SLA filters; failures stay unavailable', async () => {
  const calls = [];
  let index = 0;
  const { loadQueueCounts } = load('src/features/tickets/queue-counts.ts', {
    '@/lib/supabase/server': {
      createClient: async () => ({
        from(table) {
          const id = index++,
            chain = [];
          calls.push([table, chain]);
          const q = new Proxy(
            {},
            {
              get: (_, key) =>
                key === 'then'
                  ? (resolve, reject) =>
                      id === 2
                        ? Promise.reject(Error('offline')).then(resolve, reject)
                        : Promise.resolve({ count: id === 0 ? 80000 : 0, error: null }).then(
                            resolve,
                            reject,
                          )
                  : (...args) => {
                      chain.push([key, ...args]);
                      return q;
                    },
            },
          );
          return q;
        },
      }),
    },
  });
  const viewer = { id: 'worker', organizationId: 'org', role: 'technician' };
  assert.deepEqual(await loadQueueCounts(viewer), {
    mine: 80000,
    unassigned: 0,
    overdue: null,
    chats: 0,
  });
  assert.equal(calls.length, 4);
  for (const [, chain] of calls) {
    assert.ok(chain.some((x) => x[0] === 'select' && x[2].count === 'exact' && x[2].head === true));
    assert.ok(chain.some((x) => x[0] === 'eq' && x[1] === 'organization_id' && x[2] === 'org'));
  }
  assert.ok(
    calls[0][1].some(
      (x) => x[0] === 'eq' && x[1] === 'assigned_technician_id' && x[2] === 'worker',
    ),
  );
  assert.ok(calls[2][1].some((x) => x[0] === 'lte' && x[1] === 'sla_next_due_at'));
  await loadQueueCounts({ ...viewer, role: 'end_user' });
  assert.equal(calls.length, 4);
});
test('dashboard shortcuts distinguish zero, loading and unavailable with recovery', () => {
  const { QueueShortcuts } = load('src/features/dashboard/work-queues.tsx', {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/components/ui/retry-button': {
      RetryButton: () => React.createElement('button', null, 'Retry'),
    },
  });
  const render = (counts, loading = false) =>
    renderToStaticMarkup(React.createElement(QueueShortcuts, { counts, loading }));
  const html = render({ mine: 0, unassigned: 0, overdue: null, chats: 4 });
  assert.match(html, /No tickets assigned to you/);
  assert.match(html, /Every ticket has an owner/);
  assert.match(html, /Unavailable/);
  assert.match(html, /Retry/);
  assert.match(html, />4</);
  const loading = render({ mine: null, unassigned: null, overdue: null, chats: null }, true);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /Loading…/);
  assert.doesNotMatch(loading, /Unavailable|Retry|>0</);
});
