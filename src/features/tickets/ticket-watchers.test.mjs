import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { TicketWatchers } = load('src/features/tickets/ticket-watchers.tsx', {
  '@/app/app/tickets/organize-actions': { watchTicket() {}, unwatchTicket() {} },
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
const watchers = [
  { userId: 'me', name: 'Casey Robinson' },
  { userId: 'other', name: 'Jamie Chen' },
];
const render = (props) =>
  renderToStaticMarkup(
    React.createElement(TicketWatchers, { ticketId: 't1', viewerId: 'me', watchers, ...props }),
  );

test('the watch toggle reflects state and only administrators can remove other watchers', () => {
  const tech = render({ admin: false });
  assert.match(tech, /aria-pressed="true"[^>]*>Stop watching/);
  assert.match(tech, /Casey Robinson \(you\)/);
  assert.doesNotMatch(tech, /Remove/, 'technicians cannot remove other watchers');

  const admin = render({ admin: true });
  assert.match(admin, /Remove<span class="sr-only"> Jamie Chen as a watcher<\/span>/);
  assert.doesNotMatch(admin, /Casey Robinson as a watcher/, 'people stop watching via the toggle');

  const notWatching = render({ admin: false, watchers: [watchers[1]] });
  assert.match(notWatching, /aria-pressed="false"[^>]*>Watch ticket/);
});
