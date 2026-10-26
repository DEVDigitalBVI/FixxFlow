import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { TicketLinks } = load('src/features/tickets/ticket-links.tsx', {
  'next/link': { default: (props) => React.createElement('a', props) },
  '@/app/app/tickets/organize-actions': {
    linkTicket() {},
    unlinkTicket() {},
    markTicketDuplicate() {},
  },
  '@/components/ui/action-form': {
    ActionForm: ({ children }) => React.createElement('form', null, children),
  },
  '@/components/ui/submit-button': {
    SubmitButton: ({ children, ...props }) => {
      delete props.pendingLabel; // not a DOM attribute
      return React.createElement('button', props, children);
    },
  },
});
const render = (props) =>
  renderToStaticMarkup(
    React.createElement(TicketLinks, { ticketId: 't1', revision: 3, status: 'open', ...props }),
  );

test('linked tickets show their relationship and name each unlink control', () => {
  const html = render({
    links: [
      {
        id: 't2',
        number: 1042,
        title: 'Email is down',
        status: 'in_progress',
        relation: 'related',
      },
      { id: 't3', number: 1050, title: 'Mail bounce', status: 'closed', relation: 'duplicate' },
    ],
  });
  assert.match(html, /href="\/app\/tickets\/t2"/);
  assert.match(html, /Related · In progress/);
  assert.match(html, /Duplicate of this ticket · Closed/);
  assert.match(html, /Unlink<span class="sr-only"> ticket #1042<\/span>/);
  assert.match(html, /Close as a duplicate/);
  assert.match(html, /name="revision" value="3"/, 'duplicate closing guards against stale views');
});

test('the duplicate action is hidden once a ticket is closed or already a duplicate', () => {
  assert.doesNotMatch(render({ links: [], status: 'closed' }), /Close as a duplicate/);
  assert.doesNotMatch(
    render({
      links: [{ id: 't2', number: 1042, title: 'Main', status: 'open', relation: 'main' }],
    }),
    /Close as a duplicate/,
  );
});
