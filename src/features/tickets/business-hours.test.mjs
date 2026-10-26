import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { businessMillisecondsBetween, withinSupportHours } = load(
  'src/features/tickets/business-hours.ts',
);
const { ticketSla, queueSlaSummary } = load('src/features/tickets/sla.ts');
const at = Date.parse;

test('support time includes weekends, excludes 10 PM–7 AM, and uses workspace timezone', () => {
  assert.equal(
    businessMillisecondsBetween(at('2026-10-23T21:00Z'), at('2026-10-24T10:00Z'), 'UTC'),
    4 * 3600000,
  );
  assert.equal(
    businessMillisecondsBetween(at('2026-10-24T22:00Z'), at('2026-10-25T07:00Z'), 'UTC'),
    0,
  );
  assert.equal(withinSupportHours(at('2026-10-24T10:59:59Z'), 'America/Tortola'), false);
  assert.equal(withinSupportHours(at('2026-10-24T11:00Z'), 'America/Tortola'), true);
  assert.equal(withinSupportHours(at('2026-10-25T02:00Z'), 'America/Tortola'), false);
});
test('DST overnight transitions and fractional-offset timezones preserve 15 support hours per day', () => {
  assert.equal(
    businessMillisecondsBetween(
      at('2026-03-07T12:00Z'),
      at('2026-03-09T02:00Z'),
      'America/New_York',
    ),
    30 * 3600000,
  );
  assert.equal(
    businessMillisecondsBetween(
      at('2026-10-31T11:00Z'),
      at('2026-11-02T03:00Z'),
      'America/New_York',
    ),
    30 * 3600000,
  );
  assert.equal(
    businessMillisecondsBetween(at('2026-10-24T01:15Z'), at('2026-10-24T16:15Z'), 'Asia/Kathmandu'),
    15 * 3600000,
  );
});
const ticket = {
  created_at: '2026-10-23T21:00Z',
  status: 'open',
  first_response_at: null,
  resolved_at: null,
  closed_at: null,
  response_sla_due_at: '2026-10-24T10:00Z',
  resolution_sla_due_at: '2026-10-25T15:00Z',
  sla_timezone: 'UTC',
};
test('overnight clocks show a written paused state and support-time countdowns resume at 7 AM', () => {
  const paused = ticketSla(ticket, at('2026-10-24T02:00Z'));
  assert.equal(paused.response.state, 'paused');
  assert.match(paused.response.label, /outside support hours/);
  assert.equal(queueSlaSummary(paused).state, 'paused');
  assert.equal(
    ticketSla(ticket, at('2026-10-24T07:00Z')).response.label,
    'Due in 3h of support time',
  );
});
test('waiting freezes only resolution and does not hide a breach that predates waiting', () => {
  const waiting = {
    ...ticket,
    status: 'waiting_on_user',
    resolution_sla_due_at: null,
    resolution_sla_paused_at: '2026-10-23T21:30Z',
    resolution_sla_remaining_seconds: 7200,
  };
  const result = ticketSla(waiting, at('2026-10-25T20:00Z'));
  assert.equal(result.response.state, 'breached');
  assert.equal(result.resolution.state, 'paused');
  assert.match(result.resolution.label, /2h of support time left/);
  assert.equal(
    ticketSla({ ...waiting, resolution_sla_remaining_seconds: -60 }, at('2026-10-25T20:00Z'))
      .resolution.state,
    'breached',
  );
});

test('paused SLA indicators expose written reasons to assistive technology in compact and detail views', () => {
  const { SlaClock, SlaIndicator } = load('src/features/tickets/sla-indicator.tsx', {
    '@/features/timezones/provider': { useTimezone: () => 'UTC', Timestamp: ({ value }) => value },
  });
  const waiting = {
    ...ticket,
    status: 'waiting_on_user',
    resolution_sla_due_at: null,
    resolution_sla_paused_at: '2026-10-23T21:30Z',
    resolution_sla_remaining_seconds: 7200,
  };
  for (const compact of [false, true]) {
    const html = renderToStaticMarkup(
      React.createElement(
        SlaClock,
        { initialNow: at('2026-10-24T02:00Z') },
        React.createElement(SlaIndicator, { ticket: waiting, compact }),
      ),
    );
    assert.match(html, /Paused/);
    assert.match(html, /waiting on requester/);
    assert.match(html, /outside support hours/);
    assert.match(html, /sr-only/);
    assert.match(html, /aria-hidden="true"/);
    assert.doesNotMatch(html, /Invalid Date/);
  }
});
