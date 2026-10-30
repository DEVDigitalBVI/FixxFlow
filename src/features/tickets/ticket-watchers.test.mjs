import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';
import { productStyles } from '../../../tests/helpers/styles.mjs';

const { TicketWatchers } = load('src/features/tickets/ticket-watchers.tsx', {
  '@/app/app/tickets/organize-actions': { watchTicket() {}, unwatchTicket() {} },
  '@/components/ui/action-form': {
    ActionForm: ({ children }) => React.createElement('form', null, children),
  },
  '@/components/ui/retry-button': {
    RetryButton: ({ label }) => React.createElement('button', { type: 'button' }, label),
  },
  '@/components/ui/submit-button': {
    SubmitButton: ({ children, variant, pendingLabel, ...props }) =>
      React.createElement(
        'button',
        { ...props, type: 'submit', 'data-variant': variant, 'data-pending-label': pendingLabel },
        children,
      ),
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

test('optional notifications explain their purpose and ownership before someone follows', () => {
  const html = render({ admin: false, watchers: [] });
  assert.match(html, />Ticket notifications<\/h3>/);
  assert.match(
    html,
    /Get notified when someone replies publicly or this ticket is resolved or reopened/,
  );
  assert.match(html, /Following won’t assign the ticket to you/);
  assert.match(html, /You’re not following this ticket/);
  assert.match(html, /aria-pressed="false"[^>]*data-variant="secondary"[^>]*>Follow updates/);
  assert.match(html, /aria-describedby="ticket-following-description ticket-following-state"/);
  assert.match(html, /id="ticket-following-description"/);
  assert.match(html, /id="ticket-following-state"/);
  assert.doesNotMatch(html, /Watchers|Watch ticket|settings-card|No one is watching|<details/);
});

test('following is explicit, stays secondary and only administrators can remove another follower', () => {
  const tech = render({ admin: false });
  assert.match(tech, /aria-pressed="true"[^>]*data-variant="secondary"[^>]*>Stop following/);
  assert.match(tech, /You’re following updates on this ticket/);
  assert.match(tech, /Casey Robinson \(you\)/);
  assert.match(tech, /<details class="ticket-following-people"><summary>People following \(2\)/);
  assert.doesNotMatch(
    tech,
    /<details[^>]* open|>Remove/,
    'people are available through a closed native disclosure',
  );
  const admin = render({ admin: true });
  assert.match(admin, /Remove<span class="sr-only"> Jamie Chen from ticket updates<\/span>/);
  assert.doesNotMatch(
    admin,
    /Casey Robinson from ticket updates/,
    'people stop following via their own control',
  );
  assert.equal((admin.match(/name="userId"/g) ?? []).length, 1);
  assert.match(admin, /name="userId" value="other"/);
  assert.match(admin, /name="ticketId" value="t1"/);
});

test('an unfollowed ticket can show other followers without claiming the viewer is following', () => {
  const html = render({ admin: false, watchers: [watchers[1]] });
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /You’re not following this ticket/);
  assert.match(html, /People following \(1\)/);
  assert.match(html, /Jamie Chen/);
  assert.doesNotMatch(html, /\(you\)|Stop following/);
});

test('failed loads offer recovery without presenting an unknown following state as false', () => {
  const html = render({ admin: true, error: true });
  assert.match(html, /role="alert"/);
  assert.match(html, /We couldn’t load who follows this ticket/);
  assert.match(html, /<button type="button">Try again<\/button>/);
  assert.doesNotMatch(html, /aria-pressed|You’re not following|You’re following|<form|<details/);
});

test('the compact notification preference wraps and places its action full width on phones', () => {
  const css = productStyles().replace(/\s+/g, ' ');
  assert.match(css, /\.ticket-following-controls \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.ticket-following-copy > p[^}]*max-width: 65ch/);
  assert.match(
    css,
    /@media \(max-width: 767px\) \{[^}]*\.ticket-following-controls > form \{ width: 100%;/,
  );
  assert.match(css, /\.ticket-following-controls \.button \{ width: 100%;/);
  assert.match(
    css,
    /\.ticket-following-people > summary \{[^}]*min-height: var\(--control-height\)/,
  );
});
