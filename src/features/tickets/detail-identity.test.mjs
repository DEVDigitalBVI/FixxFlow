import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import { load } from '../../../tests/helpers/load-module.mjs';

test('full page isolates the entire workflow by ticket identity, not revision', async () => {
  let selected = 'ticket-a';
  const Workflow = () => null;
  const Announcement = () => null;
  const Incident = () => null;
  const Procedures = () => null;
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
    './service-announcement-panel': { ServiceAnnouncementPanel: Announcement },
    './incident-panel': { IncidentPanel: Incident },
    '@/features/workflows/ticket-procedures': { TicketProcedures: Procedures },
  });
  const findBy = (node, match) => {
    if (!React.isValidElement(node)) return null;
    if (match(node)) return node;
    for (const child of React.Children.toArray(node.props.children)) {
      const found = findBy(child, match);
      if (found) return found;
    }
    return null;
  };
  const find = (node) => findBy(node, (n) => n.type === Workflow);
  for (const embedded of [false]) {
    selected = 'ticket-a';
    const first = find(await TicketDetail({ ticketId: selected, embedded }));
    selected = 'ticket-b';
    const second = find(await TicketDetail({ ticketId: selected, embedded }));
    assert.ok(first);
    assert.deepEqual(
      React.Children.toArray(first.props.tools.props.children).map((child) => child.type),
      [Announcement, Incident, Procedures],
      'coordination leads with the announcement and incident work before procedures',
    );
    assert.ok(second);
    assert.ok(first.key.endsWith('ticket-a'));
    assert.ok(second.key.endsWith('ticket-b'));
    assert.notEqual(first.key, second.key);
    const refreshed = find(await TicketDetail({ ticketId: selected, embedded }));
    assert.equal(refreshed.key, second.key, 'same-ticket refresh preserves mounted drafts');
  }
  // The queue drawer is a compact view: no wizard, actions before the request and reply.
  for (const id of ['ticket-a', 'ticket-b']) {
    selected = id;
    const drawer = await TicketDetail({ ticketId: id, embedded: true });
    assert.equal(find(drawer), null, 'the drawer does not mount the full workflow');
    const order = [];
    findBy(drawer, (n) => {
      const name = n.type?.name;
      if (['TicketWorkActions', 'MessageComposer'].includes(name)) order.push(name);
      if (n.type === 'p' && n.props.className === 'ticket-description') order.push('request');
      return false;
    });
    assert.deepEqual(order, ['TicketWorkActions', 'request', 'MessageComposer']);
    const actions = findBy(drawer, (n) => n.type?.name === 'TicketWorkActions');
    assert.equal(actions.props.stage, 'all');
    const composer = findBy(drawer, (n) => n.type?.name === 'MessageComposer');
    assert.ok(composer.key.endsWith(id), 'switching tickets resets reply drafts');
  }
});
