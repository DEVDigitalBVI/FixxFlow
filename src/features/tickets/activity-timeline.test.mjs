import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { ActivityTimeline, activityDetail, activityProfileIds } = load(
  'src/features/tickets/activity-timeline.tsx',
  {
    '@/features/timezones/provider': {
      Timestamp: ({ value }) => React.createElement('span', null, value),
    },
  },
);
const names = new Map([
  ['actor', 'Alex'],
  ['worker', 'Taylor'],
]);
const event = (action, details) => ({
  id: action,
  actor_id: 'actor',
  action,
  details,
  created_at: '2026-10-24T00:00:00Z',
});
test('activity renders recorded changes with readable labels and no raw identifiers', () => {
  assert.equal(
    activityDetail(event('status_changed', { from: 'open', to: 'in_progress' }), names),
    'Open to In progress',
  );
  assert.equal(
    activityDetail(event('priority_changed', { from: 'normal', to: 'critical' }), names),
    'Normal to Urgent',
  );
  assert.equal(
    activityDetail(event('assignment_changed', { from: null, to: 'worker' }), names),
    'Unassigned to Taylor',
  );
  assert.equal(
    activityDetail(event('assignment_changed', { from: 'missing-id', to: null }), names),
    'Staff member to Unassigned',
  );
  assert.equal(activityDetail(event('details_updated', {}), names), null);
  assert.equal(
    activityDetail(event('status_changed', { from: 'unknown', to: 'private-id' }), names),
    null,
  );
  assert.equal(
    activityDetail(event('created', { status: 'new', priority: 'high' }), names),
    'Status: New · Priority: High',
  );
  assert.equal(
    activityDetail(event('automatically_routed', { team_name: 'Help desk' }), names),
    'Team: Help desk',
  );
  assert.deepEqual(
    activityProfileIds([event('assignment_changed', { from: null, to: 'worker' })]),
    ['actor', 'worker'],
  );
});
test('shared activity rows keep semantic list order, timestamps and escaped content', () => {
  const items = [event('status_changed', { from: 'open', to: 'resolved' }), event('created', {})];
  const html = renderToStaticMarkup(
    React.createElement(ActivityTimeline, { items, names: new Map([['actor', '<Alex>']]) }),
  );
  assert.match(html, /role="list" aria-label="Ticket activity, newest first"/);
  assert.match(html, /Open to Resolved/);
  assert.match(html, /&lt;Alex&gt;/);
  assert.match(html, /<time dateTime="2026-10-24T00:00:00Z"/);
  assert.equal((html.match(/class="ticket-activity-item"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /management-list/);
});

test('employee reopening history identifies the action and shows the recorded reason safely', () => {
  const html = renderToStaticMarkup(
    React.createElement(ActivityTimeline, {
      items: [
        event('status_changed', {
          from: 'closed',
          to: 'open',
          reason: 'Still broken <script>bad</script>',
        }),
      ],
      names,
    }),
  );
  assert.match(html, /reopened the ticket/);
  assert.match(html, /Closed to Open/);
  assert.match(html, /Reason:/);
  assert.match(html, /Still broken &lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
