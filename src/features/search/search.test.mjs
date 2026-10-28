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
  const rows = [
    { id: 'article', kind: 'article', label: 'VPN guide', audience: 'employees', shared: true },
    { id: 'ticket', kind: 'ticket', label: 'VPN', detail: '#123', approximate: true },
    { id: 'person', kind: 'person', label: 'Pat', detail: 'pat@example.invalid' },
  ];
  return {
    calls,
    search: load('src/features/search/service.ts', {
      '@/lib/auth/viewer': {
        requireViewer: async () => ({ role, id: 'viewer', organizationId: 'org' }),
      },
      '@/lib/supabase/server': {
        createClient: async () => ({
          rpc: async (name, args) => {
            calls.push([name, args]);
            return { data: rows, error: error ? new Error('private detail') : null };
          },
        }),
      },
    }).searchWorkspace,
  };
}
test('workspace search preserves database ranking across entities using the viewer organization', async () => {
  const f = service();
  const rows = await f.search('  VPN  ');
  assert.deepEqual(
    rows.map((r) => r.group),
    ['Articles', 'Tickets', 'People'],
  );
  assert.deepEqual(f.calls, [['search_workspace', { org: 'org', search_text: 'VPN' }]]);
  assert.equal(rows[1].approximate, true);
  assert.equal(rows[0].href, '/app/help/article');
  const groups = groupSearchResults(rows, true);
  assert.equal(groups[0].label, 'Best matches');
  assert.deepEqual(
    groups[0].entries.map((e) => e.index),
    [0, 1, 2],
  );
});
test('employee results never include people even if an unexpected RPC row arrives', async () => {
  assert.deepEqual(
    (await service('end_user').search('VPN')).map((r) => r.group),
    ['Articles', 'Tickets'],
  );
});
test('empty queries avoid database calls and database failure is distinct from no matches', async () => {
  const f = service();
  assert.deepEqual(await f.search(' '), []);
  assert.deepEqual(f.calls, []);
  await assert.rejects(service('administrator', true).search('VPN'), /Search unavailable/);
});
