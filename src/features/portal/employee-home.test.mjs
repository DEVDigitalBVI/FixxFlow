import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { EmployeeHome } = load('src/features/portal/employee-home.tsx', {
  'next/link': { default: (props) => React.createElement('a', props) },
});
const render = (recent) =>
  renderToStaticMarkup(
    React.createElement(EmployeeHome, {
      firstName: 'Jamaal',
      greeting: 'Good morning',
      organizationName: 'Example',
      recent,
      timeZone: 'America/Tortola',
    }),
  );

test('employee home offers support routes and a labeled GET search into help results', () => {
  const html = render([]);
  assert.match(html, /href="\/app\/chat\?start=1"/);
  assert.match(html, /href="\/app\/tickets\/new"/);
  assert.match(
    html,
    /<form role="search" aria-label="Help articles" action="\/app\/help" method="get">/,
  );
  assert.match(html, /<label for="home-help-query">Search help articles<\/label>/);
  assert.match(
    html,
    /id="home-help-query" type="search" maxLength="200" aria-describedby="home-help-hint"[^>]*name="q"/,
  );
  assert.match(html, /type="submit">Search/);
  assert.match(html, /href="\/app\/help">Browse help articles/);
  assert.match(html, /No requests yet/);
  assert.doesNotMatch(html, /portal-action-primary/);
});

test('recent requests expose human-readable status and timestamp alongside their identity', () => {
  const html = render([
    {
      id: 'request-1',
      ticket_number: 1003,
      title: 'Laptop access',
      status: 'waiting_on_user',
      updated_at: '2026-10-19T16:30:00Z',
    },
  ]);
  assert.match(html, /href="\/app\/tickets\/request-1"/);
  assert.match(html, /Laptop access/);
  assert.match(html, /#1003/);
  assert.match(html, /ticket-badge tone-amber">Waiting on user/);
  assert.match(html, /Updated <time dateTime="2026-10-19T16:30:00Z">/);
  assert.doesNotMatch(html, /No requests yet/);
});
