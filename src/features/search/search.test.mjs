import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { searchDestinations, matchDestinations, groupSearchResults } = load(
  'src/features/search/model.ts',
);
test('navigation results match literal terms and respect role and inventory access', () => {
  const employee = searchDestinations('end_user', false);
  assert.equal(
    employee.some((row) =>
      ['/app/people', '/app/administration', '/app/inventory', '/app/reports'].includes(row.href),
    ),
    false,
  );
  assert.equal(
    searchDestinations('end_user', true).some((row) => row.href === '/app/inventory'),
    true,
  );
  assert.equal(
    searchDestinations('technician', true).some((row) => row.href === '/app/administration'),
    false,
  );
  assert.equal(matchDestinations(employee, 'HELP ART').length, 1);
  assert.equal(
    matchDestinations(searchDestinations('administrator', true), 'admin')[0]?.label,
    'Settings',
  );
  assert.equal(matchDestinations(employee, '%').length, 0);
});
test('grouped results retain selection indices, group order and duplicate IDs from different features', () => {
  const results = [
    { id: 'same', label: 'Ticket', href: '/app/tickets/same', group: 'Tickets' },
    { id: 'same', label: 'Person', href: '/app/people/same', group: 'People' },
    { id: 'other', label: 'Another ticket', href: '/app/tickets/other', group: 'Tickets' },
  ];
  const groups = groupSearchResults(results);
  assert.deepEqual(
    groups.map((group) => group.label),
    ['Tickets', 'People'],
  );
  assert.deepEqual(
    groups.map((group) => group.entries.map((entry) => entry.index)),
    [[0, 2], [1]],
  );
  for (const group of groups)
    for (const entry of group.entries) assert.equal(entry.result, results[entry.index]);
  assert.deepEqual(groupSearchResults([]), []);
});
function service(role = 'administrator', error = false) {
  const calls = [];
  const db = {
    rpc(name, args) {
      calls.push([name, args]);
      return builder(name);
    },
    from(name) {
      calls.push([name]);
      return builder(name);
    },
  };
  function builder(name) {
    const query = new Proxy(
      {},
      {
        get(_, key) {
          if (key === 'then')
            return (resolve) =>
              Promise.resolve({
                data:
                  name === 'search_tickets'
                    ? [{ id: 'ticket', ticket_number: 123, title: 'VPN' }]
                    : name === 'search_members'
                      ? [{ user_id: 'person' }]
                      : name === 'profiles'
                        ? [{ user_id: 'person', display_name: 'Pat', email: 'pat@example.invalid' }]
                        : [{ id: 'article', title: 'VPN guide', audience: 'employees' }],
                error: error ? new Error('private database detail') : null,
              }).then(resolve);
          return (...args) => {
            calls.push([name, key, ...args]);
            return query;
          };
        },
      },
    );
    return query;
  }
  return {
    calls,
    search: load('src/features/search/service.ts', {
      '@/lib/auth/viewer': {
        requireViewer: async () => ({ role, id: 'viewer', organizationId: 'org' }),
      },
      '@/lib/supabase/server': { createClient: async () => db },
    }).searchWorkspace,
  };
}
test('workspace search uses bounded existing RPCs and organization scopes, never an admin client', async () => {
  const f = service();
  const results = await f.search('  VPN  ');
  assert.deepEqual(
    results.map((row) => row.group),
    ['Tickets', 'People', 'Articles'],
  );
  assert.equal(f.calls.filter((row) => row[1] === 'limit' && row[2] === 8).length, 3);
  assert.equal(
    f.calls.filter((row) => row[1] === 'eq' && row[2] === 'organization_id' && row[3] === 'org')
      .length,
    3,
  );
  assert.ok(
    f.calls.some(
      (row) =>
        row[0] === 'search_knowledge_articles' &&
        row[1] === 'or' &&
        row[2] === 'organization_id.eq.org,organization_id.is.null',
    ),
  );
  assert.ok(f.calls.some((row) => row[0] === 'search_tickets' && row[1]?.search_text === 'VPN'));
});
test('employee search omits people queries and further restricts tickets to the requester', async () => {
  const f = service('end_user');
  const results = await f.search('VPN');
  assert.deepEqual(
    results.map((row) => row.group),
    ['Tickets', 'Articles'],
  );
  assert.equal(
    f.calls.some((row) => row[0] === 'search_members' || row[0] === 'profiles'),
    false,
  );
  assert.ok(
    f.calls.some((row) => row[1] === 'eq' && row[2] === 'requester_id' && row[3] === 'viewer'),
  );
});
test('empty searches avoid operational queries; failures reject without returning partial sensitive rows', async () => {
  const f = service();
  assert.deepEqual(await f.search('  '), []);
  assert.deepEqual(f.calls, []);
  await assert.rejects(service('administrator', true).search('VPN'), /Search unavailable/);
});
