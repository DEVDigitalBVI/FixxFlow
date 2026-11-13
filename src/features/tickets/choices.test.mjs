import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const viewer = { id: 'worker', role: 'technician', organizationId: 'org' };
function route(role = 'technician', fail = false) {
  const calls = [];
  const { GET } = load('src/app/app/tickets/choices/route.ts', {
    'next/navigation': { unstable_rethrow() {} },
    '@/lib/auth/viewer': { requireWorkspaceAccess: async () => ({ ...viewer, role }) },
    '@/lib/server-errors': { reportServerError() {} },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return fail ? { error: Error('Outage') } : { data: [{ tag: 'vpn' }] };
        },
        from(table) {
          calls.push({ table });
          const q = new Proxy(
            {},
            {
              get: (_, key) =>
                key === 'then'
                  ? (resolve) =>
                      Promise.resolve(
                        fail
                          ? { error: Error('Outage') }
                          : { data: [{ id: 'one', title: 'VPN', body: 'Reconnect' }] },
                      ).then(resolve)
                  : (...args) => {
                      calls.push({ [key]: args });
                      return q;
                    },
            },
          );
          return q;
        },
      }),
    },
  });
  return { GET, calls };
}
const request = (kind) => new Request(`https://example.test/app/tickets/choices?kind=${kind}`);
test('picker endpoints are staff only, private/no-store and scoped to authenticated organization', async () => {
  const f = route();
  let response = await f.GET(request('tags'));
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), { items: ['vpn'] });
  assert.deepEqual(f.calls[0], { name: 'ticket_tag_suggestions', args: { org: 'org' } });
  response = await f.GET(request('saved-replies'));
  assert.equal(response.status, 200);
  assert.ok(f.calls.some((c) => c.eq?.[0] === 'organization_id' && c.eq[1] === 'org'));
  assert.ok(f.calls.some((c) => c.limit?.[0] === 200));
  const employee = route('end_user');
  assert.equal((await employee.GET(request('tags'))).status, 403);
  assert.deepEqual(employee.calls, []);
});
test('picker endpoints reject invalid requests before querying and contain failures', async () => {
  const invalid = route();
  for (const path of ['?kind=unknown', '?kind=tags&org=foreign', '?kind=tags&kind=tags'])
    assert.equal(
      (await invalid.GET(new Request('https://example.test/app/tickets/choices' + path))).status,
      400,
    );
  assert.deepEqual(invalid.calls, []);
  for (const kind of ['tags', 'saved-replies']) {
    const response = await route('technician', true).GET(request(kind));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /could not load/);
  }
});
