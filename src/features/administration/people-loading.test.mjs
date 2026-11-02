import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('People loads page-scoped statuses, profiles and permissions concurrently', async () => {
  const reads = [
    'member_account_statuses',
    'profiles',
    'inventory_managers',
    'inventory_requesters',
  ];
  const gates = Object.fromEntries(reads.map((name) => [name, deferred()]));
  const started = [];
  const scopes = [];
  const member = { user_id: 'member-1', role: 'end_user', status: 'active' };
  function query(table) {
    const builder = new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'then'
            ? (resolve, reject) => {
                started.push(table);
                return (
                  gates[table]?.promise ??
                  Promise.resolve({
                    data: table === 'organization_memberships' ? [member] : [],
                    count: 1,
                    error: null,
                  })
                ).then(resolve, reject);
              }
            : (...args) => {
                if (key === 'eq' || key === 'in') scopes.push([table, key, ...args]);
                return builder;
              },
      },
    );
    return builder;
  }
  const Page = load('src/app/app/people/page.tsx', {
    '@/lib/auth/viewer': {
      requireViewer: async () => ({
        role: 'administrator',
        organizationId: 'trusted-org',
        id: 'self',
      }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        from: query,
        rpc: (name, args) => {
          assert.equal(name, 'member_account_statuses');
          assert.deepEqual(args, { org: 'trusted-org', members: ['member-1'] });
          started.push(name);
          return gates[name].promise;
        },
      }),
    },
  }).default;
  let finished = false;
  const pending = Page({ searchParams: Promise.resolve({}) }).then((page) => {
    finished = true;
    return page;
  });
  await new Promise((resolve) => setImmediate(resolve));
  try {
    for (const read of reads)
      assert.ok(started.includes(read), `${read} starts before other details finish`);
    for (const table of reads.slice(1)) {
      assert.ok(
        scopes.some(
          (c) =>
            c[0] === table && c[1] === 'eq' && c[2] === 'organization_id' && c[3] === 'trusted-org',
        ),
      );
      assert.ok(
        scopes.some(
          (c) =>
            c[0] === table && c[1] === 'in' && c[2] === 'user_id' && c[3].join() === 'member-1',
        ),
      );
    }
    assert.equal(finished, false);
  } finally {
    for (const read of reads)
      gates[read].resolve({
        data:
          read === 'member_account_statuses'
            ? [{ user_id: 'member-1', account_status: 'invited' }]
            : [],
        error: null,
      });
    await pending;
  }
  assert.equal(finished, true);
});
