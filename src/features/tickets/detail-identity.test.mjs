import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import { load } from '../../../tests/helpers/load-module.mjs';

test('full page and queue drawer isolate the entire workflow by ticket identity, not revision', async () => {
  let selected = 'ticket-a';
  const Workflow = () => null;
  const db = {
    from(table) {
      const response = () => ({
        data:
          table === 'tickets'
            ? {
                id: selected,
                ticket_number: 1004,
                requester_id: 'employee',
                assigned_technician_id: 'worker',
                status: 'in_progress',
                priority: 'normal',
                ticket_type: 'support',
                request_kind: 'ticket',
                title: 'Request',
                description: 'Help',
                revision: 3,
              }
            : table === 'ticket_workflows'
              ? null
              : [],
        error: null,
      });
      const q = new Proxy(
        {},
        {
          get: (_, key) =>
            key === 'then' ? (resolve) => Promise.resolve(response()).then(resolve) : () => q,
        },
      );
      return q;
    },
  };
  const { TicketDetail } = load('src/features/tickets/ticket-detail.tsx', {
    '@/lib/auth/viewer': {
      requireViewer: async () => ({
        id: 'worker',
        role: 'technician',
        organizationId: 'org',
        timeZone: 'UTC',
      }),
    },
    '@/lib/supabase/server': { createClient: async () => db },
    '@/features/lookups/labels': { profileLabels: async () => [] },
    './ticket-workflow': { TicketWorkflow: Workflow },
  });
  const find = (node) => {
    if (!React.isValidElement(node)) return null;
    if (node.type === Workflow) return node;
    for (const child of React.Children.toArray(node.props.children)) {
      const match = find(child);
      if (match) return match;
    }
    return null;
  };
  for (const embedded of [false, true]) {
    selected = 'ticket-a';
    const first = find(await TicketDetail({ ticketId: selected, embedded }));
    selected = 'ticket-b';
    const second = find(await TicketDetail({ ticketId: selected, embedded }));
    assert.ok(first);
    assert.ok(second);
    assert.ok(first.key.endsWith('ticket-a'));
    assert.ok(second.key.endsWith('ticket-b'));
    assert.notEqual(first.key, second.key);
    const refreshed = find(await TicketDetail({ ticketId: selected, embedded }));
    assert.equal(refreshed.key, second.key, 'same-ticket refresh preserves mounted drafts');
  }
});
