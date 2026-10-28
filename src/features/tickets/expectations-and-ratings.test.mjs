import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const { impactExpectations, requestExpectations, supportDuration } = load(
  'src/features/tickets/expectations.ts',
);
const ratings = load('src/features/tickets/ratings.ts');
const { activityDetail } = load('src/features/tickets/activity-timeline.tsx', {
  '@/features/timezones/provider': { Timestamp: () => null },
});
const id = '10000000-0000-4000-8000-000000000001';
const hour = 3_600_000;
const now = Date.parse('2026-10-27T12:00:00Z');
const iso = (offset) => new Date(now + offset).toISOString();
const base = {
  created_at: iso(-2 * hour),
  status: 'open',
  first_response_at: null,
  resolved_at: null,
  closed_at: null,
  response_sla_due_at: iso(2 * hour),
  resolution_sla_due_at: iso(20 * hour),
  sla_timezone: null,
};

test('impact choices state reply and resolution targets in support hours', () => {
  const rows = impactExpectations();
  assert.deepEqual(
    rows.map((row) => [row.label, row.response, row.resolution]),
    [
      ['Minor inconvenience', '8 support hours', '48 support hours'],
      ['Work blocked', '4 support hours', '24 support hours'],
      ['Team affected', '1 support hour', '8 support hours'],
      ['Operations stopped', '15 minutes', '4 support hours'],
    ],
  );
  assert.equal(supportDuration(60), '1 support hour');
});

test('request expectations describe promises and outcomes without SLA jargon', () => {
  const open = requestExpectations(base, now);
  assert.equal(open.reply.text, 'Expect a first reply by');
  assert.equal(open.reply.at, base.response_sla_due_at);
  assert.equal(open.resolution.text, 'We aim to resolve this by');
  assert.equal(open.resolution.tone, 'neutral');

  const late = requestExpectations({ ...base, response_sla_due_at: iso(-hour) }, now);
  assert.equal(late.reply.tone, 'warning');
  assert.equal(late.reply.icon, 'alert');
  assert.match(late.reply.note, /still in the queue/);

  const replied = requestExpectations({ ...base, first_response_at: iso(-hour) }, now);
  assert.deepEqual([replied.reply.text, replied.reply.tone], ['IT replied', 'success']);

  const waiting = requestExpectations(
    {
      ...base,
      status: 'waiting_on_user',
      first_response_at: iso(-hour),
      resolution_sla_paused_at: iso(-hour),
      resolution_sla_remaining_seconds: 3600,
      resolution_sla_due_at: null,
    },
    now,
  );
  assert.match(waiting.resolution.text, /waiting for your reply.*paused/);
  assert.equal(waiting.resolution.at, null);

  const held = requestExpectations({ ...base, status: 'on_hold' }, now);
  assert.match(held.resolution.text, /^On hold with IT/);

  const overdue = requestExpectations({ ...base, resolution_sla_due_at: iso(-hour) }, now);
  assert.equal(overdue.resolution.tone, 'warning');
  assert.match(overdue.resolution.note, /remains open/);

  // A resolved request without a recorded reply shows only its outcome.
  const done = requestExpectations({ ...base, status: 'resolved', resolved_at: iso(-hour) }, now);
  assert.equal(done.reply, null);
  assert.deepEqual([done.resolution.text, done.resolution.at], ['Resolved', iso(-hour)]);
});

test('ratings validate input, describe scores in words and honor the 30-day window', () => {
  const form = (values) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  };
  assert.deepEqual(ratings.parseRating(form({ ticketId: id, score: '4', comment: '  Quick  ' })), {
    ok: true,
    ticketId: id,
    score: 4,
    comment: 'Quick',
  });
  assert.equal(ratings.parseRating(form({ ticketId: id, score: '4', comment: ' ' })).comment, null);
  assert.equal(ratings.parseRating(form({ ticketId: id, score: '6' })).field, 'score');
  assert.equal(ratings.parseRating(form({ ticketId: id })).field, 'score');
  assert.equal(
    ratings.parseRating(form({ ticketId: id, score: '3', comment: 'x'.repeat(1001) })).field,
    'comment',
  );
  assert.equal(ratings.parseRating(form({ ticketId: 'nope', score: '3' })).field, 'ticketId');
  assert.equal(ratings.describeRating(4), 'Satisfied · 4 of 5');
  assert.equal(ratings.ratingWindowOpen(iso(-29 * 24 * hour), now), true);
  assert.equal(ratings.ratingWindowOpen(iso(-30 * 24 * hour), now), false);
  assert.equal(ratings.ratingWindowOpen(null, now), false);
  assert.equal(ratings.satisfiedPercent({ responses: 3, satisfied: 2 }), 67);
  assert.equal(ratings.satisfiedPercent({ responses: 0, satisfied: 0 }), null);
  const summary = {
    days: 30,
    responses: 1,
    average: 4,
    satisfied: 1,
    distribution: [{ score: 4, count: 1 }],
    comments: [
      {
        score: 4,
        comment: 'Good',
        updated_at: iso(0),
        ticket_id: id,
        ticket_number: 7,
        title: 'VPN',
      },
    ],
  };
  assert.equal(ratings.isSatisfactionSummary(summary), true);
  assert.equal(ratings.isSatisfactionSummary({ ...summary, comments: [{}] }), false);
  assert.equal(
    activityDetail({ action: 'resolution_rated', details: { score: 5, previous: 2 } }, new Map()),
    'Dissatisfied · 2 of 5 to Very satisfied · 5 of 5',
  );
});

test('the rating card uses a labeled native radio group and keeps changes behind a disclosure', () => {
  const action = async () => ({});
  const fresh = componentHarness('src/features/tickets/resolution-rating.tsx', 'ResolutionRating', {
    ticketId: id,
    rating: null,
    canRate: true,
    action,
  });
  try {
    const form = fresh.find((n) => n.props.action);
    const fields = [];
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object' && node.props) {
        fields.push(node);
        walk(node.props.children);
      }
    };
    walk(form.props.children);
    const legend = fields.find((n) => n.type === 'legend');
    assert.match(legend.props.children, /How satisfied/);
    const radios = fields.filter((n) => n.type === 'input' && n.props.type === 'radio');
    assert.equal(radios.length, 5);
    assert.ok(radios.every((radio) => radio.props.required && radio.props.name === 'score'));
    const labels = fields.filter(
      (n) => n.type === 'label' && n.props.className === 'rating-option',
    );
    assert.equal(labels.length, 5);
    assert.ok(fields.some((n) => n.type === 'textarea' && n.props.maxLength === 1000));
    assert.equal(fresh.all((n) => n.type === 'details').length, 0);
  } finally {
    fresh.close();
  }

  const rated = componentHarness('src/features/tickets/resolution-rating.tsx', 'ResolutionRating', {
    ticketId: id,
    rating: { score: 4, comment: 'Thanks' },
    canRate: true,
    action,
  });
  try {
    assert.equal(rated.find((n) => n.type === 'summary').props.children, 'Change your rating');
    assert.ok(rated.find((n) => n.type === 'strong' && n.props.children === 'Satisfied · 4 of 5'));
  } finally {
    rated.close();
  }

  const closed = componentHarness(
    'src/features/tickets/resolution-rating.tsx',
    'ResolutionRating',
    {
      ticketId: id,
      rating: null,
      canRate: false,
      action,
    },
  );
  try {
    assert.equal(closed.all((n) => Boolean(n.props?.action)).length, 0);
  } finally {
    closed.close();
  }
});

test('impact guidance renders as a captioned table inside a native disclosure', () => {
  const { ImpactExpectations } = load('src/features/tickets/impact-expectations.tsx');
  const html = renderToStaticMarkup(React.createElement(ImpactExpectations));
  assert.match(
    html,
    /^<details class="impact-expectations"><summary>How quickly will IT respond\?/,
  );
  assert.match(html, /<caption>[^<]*support hours, 7 AM–10 PM every day/);
  assert.equal(html.match(/<th scope="row">/g).length, 4);
  assert.match(html, /<th scope="col">First reply within<\/th>/);
});
