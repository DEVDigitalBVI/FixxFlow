import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';

function queue(failure = null) {
  const calls = [], logged = [];
  const rows = Array.from({ length: 51 }, (_, n) => ({ id: `ticket-${n}`, requester_id: `person-${n}`, assigned_technician_id: 'worker', team_id: `team-${n % 2}` }));
  const db = { from(table) {
    calls.push([table]);
    const query = new Proxy({}, { get: (_, key) => key === 'then'
      ? resolve => Promise.resolve({ data: table === 'tickets' ? rows : [], error: table === 'profiles' ? failure : null }).then(resolve)
      : (...args) => { calls.push([table, key, ...args]); return query; } });
    return query;
  } };
  const mocks = {
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/server-errors': { reportServerError: (...args) => logged.push(args) },
  };
  return { ...load('src/features/tickets/data.ts', mocks), calls, logged };
}

test('queue display names and teams are scoped to the visible page, excluding lookahead rows', async () => {
  const q = queue();
  await q.loadTicketQueue({ role: 'technician', organizationId: 'verified-org' }, {});
  const names = q.calls.find(c => c[0] === 'profiles' && c[1] === 'in')[3];
  assert.equal(names.length, 51); assert.ok(names.includes('worker')); assert.ok(names.includes('person-49'));
  assert.ok(!names.includes('person-50'));
  assert.deepEqual(q.calls.find(c => c[0] === 'teams' && c[1] === 'in')[3], ['team-0', 'team-1']);
  assert.ok(q.calls.some(c => c[0] === 'profiles' && c[1] === 'eq' && c[2] === 'organization_id' && c[3] === 'verified-org'));
  assert.ok(!q.calls.some(c => c[0] === 'organization_memberships'));
});

test('profile lookup outages cannot silently turn known queue names into missing names', async () => {
  const q = queue({ code: '08006' });
  await assert.rejects(q.loadTicketQueue({ role: 'technician', organizationId: 'verified-org' }, {}), /Names could not load/);
  assert.equal(q.logged[0][0], 'ticket.references');
});
