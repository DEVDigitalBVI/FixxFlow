import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const viewer = { id: 'worker', role: 'technician', organizationId: 'org', timeZone: 'UTC' };
function fixture() {
  const tables = [],
    profiles = [];
  const db = {
    from(table) {
      tables.push(table);
      const data =
        table === 'tickets'
          ? {
              id: 'ticket',
              requester_id: 'requester',
              assigned_technician_id: 'owner',
              ticket_type: 'support',
              request_kind: 'ticket',
              status: 'open',
              priority: 'normal',
              title: 'Request',
              description: 'Help',
              revision: 1,
            }
          : table === 'ticket_messages'
            ? [{ author_id: 'author' }]
            : [];
      const q = new Proxy(
        {},
        {
          get: (_, key) =>
            key === 'then'
              ? (resolve) => Promise.resolve({ data, error: null }).then(resolve)
              : () => q,
        },
      );
      return q;
    },
    storage: {
      from() {
        throw Error('Shell must never sign files');
      },
    },
  };
  const loaded = load('src/features/tickets/ticket-detail.tsx', {
    '@/lib/auth/viewer': { requireViewer: async () => viewer },
    '@/lib/supabase/server': { createClient: async () => db },
    '@/features/lookups/labels': {
      profileLabels: async (_db, org, ids) => {
        assert.equal(org, 'org');
        profiles.push(ids);
        return [];
      },
    },
  });
  return { ...loaded, tables, profiles };
}
function elements(node, visit) {
  if (!React.isValidElement(node)) return;
  visit(node);
  for (const child of React.Children.toArray(node.props.children)) elements(child, visit);
}
for (const embedded of [true, false])
  test(`${embedded ? 'drawer' : 'full-page shell'} queries only displayed core data before streaming`, async () => {
    const f = fixture();
    const tree = await f.TicketDetail({ ticketId: 'ticket', embedded });
    assert.deepEqual(f.tables, ['tickets', 'ticket_messages', 'ticket_tags', 'ticket_links']);
    assert.deepEqual(f.profiles, [['requester', 'owner', 'author']]);
    const composers = [];
    elements(tree, (n) => {
      if (n.type?.name === 'MessageComposer') composers.push(n);
    });
    if (embedded) {
      assert.equal(composers.length, 1);
      assert.equal(composers[0].props.lazySavedReplies, true);
    } else {
      let workspace;
      elements(tree, (n) => {
        if (n.type?.name === 'TicketWorkspace') workspace = n;
      });
      assert.ok(workspace);
      assert.equal(workspace.props.coordinationSection.props.label, 'Coordination');
      assert.equal(workspace.props.files.props.label, 'Files');
      assert.equal(workspace.props.history.props.label, 'Activity');
    }
  });

test('independent panel loaders wait behind Suspense and failures are local with retry', async () => {
  const { TicketPanel, SafeTicketPanel } = load('src/features/tickets/ticket-panel.tsx', {
    'next/navigation': { unstable_rethrow() {} },
    '@/components/ui/retry-button': {
      RetryButton: () => React.createElement('button', null, 'Retry'),
    },
  });
  let calls = 0;
  const panel = TicketPanel({
    label: 'Activity',
    load: async () => {
      calls++;
      throw Error('Unavailable');
    },
  });
  assert.equal(calls, 0);
  assert.equal(panel.props.children.type, React.Suspense);
  assert.match(renderToStaticMarkup(panel.props.children.props.fallback), /Loading activity/);
  const failed = await SafeTicketPanel(panel.props.children.props.children.props);
  assert.equal(calls, 1);
  assert.match(renderToStaticMarkup(failed), /Activity could not load.*Retry/);
  const ready = await SafeTicketPanel({
    label: 'Files',
    load: async () => React.createElement('p', null, 'Files ready'),
  });
  assert.match(renderToStaticMarkup(ready), /Files ready/);
});

test('request memoization shares workflow reads by primitive org/ticket keys, preserving failures', async () => {
  let reads = 0;
  const memo = new Map();
  const cache =
    (fn) =>
    (...args) => {
      const key = JSON.stringify(args);
      if (!memo.has(key)) memo.set(key, fn(...args));
      return memo.get(key);
    };
  const db = {
    from(table) {
      assert.equal(table, 'ticket_workflows');
      reads++;
      const q = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: { message: 'Outage' } }),
      };
      return q;
    },
  };
  const { loadTicketWorkflow } = load('src/features/tickets/ticket-loaders.ts', {
    react: { ...React, cache },
    '@/lib/auth/viewer': { requireViewer: async () => viewer },
    '@/lib/supabase/server': { createClient: async () => db },
  });
  const [a, b, c] = await Promise.all([
    loadTicketWorkflow('org', 'ticket'),
    loadTicketWorkflow('org', 'ticket'),
    loadTicketWorkflow('org', 'ticket'),
  ]);
  assert.equal(reads, 1);
  assert.equal(a, b);
  assert.equal(b, c);
  assert.ok(a.error);
  await assert.rejects(loadTicketWorkflow('foreign', 'ticket'));
  assert.equal(reads, 1);
});

test('non-incident declaration makes no incident/subpanel queries', async () => {
  const { IncidentPanel } = load('src/features/tickets/incident-panel.tsx', {
    '@/lib/supabase/server': {
      createClient: async () => {
        throw Error('No query expected');
      },
    },
  });
  const result = await IncidentPanel({
    organizationId: 'org',
    ticketId: 'ticket',
    revision: 1,
    ownerId: 'worker',
    isIncident: false,
  });
  assert.ok(result);
});
