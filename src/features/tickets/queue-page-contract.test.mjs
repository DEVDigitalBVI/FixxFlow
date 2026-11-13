import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import { renderTicketQueue } from '../../../tests/fixtures/ticket-queue.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const id = '00000000-0000-4000-8000-000000000001';
async function pageFor(role) {
  const filters = {
    view: 'team',
    q: 'VPN & access',
    status: 'open',
    sort: 'oldest',
    page: '2',
    ticket: id,
  };
  const Page = load('src/app/app/tickets/page.tsx', {
    '@/lib/auth/viewer': { requireViewer: async () => ({ role }) },
    '@/features/tickets/data': {
      loadTicketQueue: async () => ({
        view: 'team',
        sort: 'oldest',
        search: filters.q,
        page: 2,
        rows: [],
        profiles: [],
        teams: [],
        tagOptions: [],
        savedViews: [],
      }),
    },
    './actions': { bulkUpdateTickets: async () => {} },
  }).default;
  // Resolve only the server view wrappers, leaving the drawer boundary unrendered.
  let tree = await Page({ searchParams: Promise.resolve(filters) });
  while (typeof tree.type === 'function' && tree.type.name !== 'TicketQueueContext')
    tree = await tree.type(tree.props);
  assert.ok(React.isValidElement(tree));
  return tree;
}
test('queue keeps the staff drawer boundary and exact return address, employees cannot open it', async () => {
  const staff = await pageFor('technician');
  assert.equal(staff.props.selected, id);
  assert.equal(
    staff.props.returnTo,
    '/app/tickets?q=VPN+%26+access&view=team&status=open&sort=oldest&page=2',
  );
  assert.equal(staff.props.panel.type, React.Suspense);
  assert.equal(staff.props.panel.props.children.props.ticketId, id);
  assert.equal(staff.props.panel.props.children.props.embedded, true);
  const employee = await pageFor('end_user');
  assert.equal(employee.props.allowDrawer, false);
  assert.equal(employee.props.panel, null);
});
test('ticket and pagination links preserve queue filters and omit the selected drawer', async () => {
  const html = await renderTicketQueue({
    filters: {
      view: 'team',
      q: 'VPN & access',
      status: 'open',
      sort: 'oldest',
      page: '2',
      ticket: id,
    },
  });
  assert.match(
    html,
    /href="\/app\/tickets\?q=VPN\+%26\+access&amp;view=team&amp;status=open&amp;sort=oldest&amp;page=1"/,
  );
  const ticket = html
    .match(/data-queue-ticket="ticket-0"[^>]*href="([^"]+)"/)[1]
    .replaceAll('&amp;', '&');
  const url = new URL(ticket, 'https://example.test');
  assert.equal(
    url.searchParams.get('returnTo'),
    '/app/tickets?q=VPN+%26+access&view=team&status=open&sort=oldest&page=2',
  );
});
