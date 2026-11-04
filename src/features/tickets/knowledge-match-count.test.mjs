import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

function fixture(result) {
  const calls = [],
    logged = [];
  const builder = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then'
          ? (resolve, reject) => Promise.resolve(result).then(resolve, reject)
          : (...args) => {
              calls.push([key, ...args]);
              return builder;
            },
    },
  );
  const { KnowledgeMatchCount } = load('src/features/tickets/knowledge-match-count.tsx', {
    'next/navigation': { unstable_rethrow: () => {} },
    '@/lib/server-errors': { reportServerError: (...args) => logged.push(args) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: (...args) => {
          calls.push(['rpc', ...args]);
          return builder;
        },
      }),
    },
  });
  return {
    run: () => KnowledgeMatchCount({ organizationId: 'trusted-org', search: 'VPN' }),
    calls,
    logged,
  };
}

test('streamed article counts retain tenant and published-article restrictions', async () => {
  for (const [count, expected] of [
    [0, null],
    [1, ' (1 match)'],
    [3, ' (3 matches)'],
  ]) {
    const h = fixture({ count, error: null });
    assert.equal(await h.run(), expected);
    assert.deepEqual(h.calls[0], [
      'rpc',
      'search_knowledge_articles',
      {
        target_organization_id: 'trusted-org',
        search_text: 'VPN',
      },
      { count: 'exact', head: true },
    ]);
    assert.ok(h.calls.some((c) => c[0] === 'eq' && c[1] === 'status' && c[2] === 'published'));
  }
});

test('an optional article-count outage is reported without breaking the ticket queue', async () => {
  const h = fixture({ count: null, error: { code: '57014' } });
  assert.equal(await h.run(), null);
  assert.equal(h.logged[0][0], 'knowledge.count');
});
