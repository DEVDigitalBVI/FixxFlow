import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { ChatSupportHours } = load('src/features/chat/support-hours.tsx');
const { ChatLifecycleNotice } = load('src/features/chat/lifecycle-notice.tsx', {
  'next/link': { default: (props) => React.createElement('a', props) },
});
test('support availability follows 7 AM inclusive to 10 PM exclusive every day in the workspace timezone', () => {
  for (const [at, offline] of [
    ['2026-10-24T10:59:59Z', true],
    ['2026-10-24T11:00:00Z', false],
    ['2026-10-25T01:59:59Z', false],
    ['2026-10-25T02:00:00Z', true],
    ['2026-10-25T11:00:00Z', false],
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(ChatSupportHours, {
        timeZone: 'America/Tortola',
        initialAt: Date.parse(at),
      }),
    );
    assert.equal(html.includes('IT is offline'), offline, at);
    assert.match(html, /7 AM–10 PM, every day/);
    assert.match(html, /America\/Tortola/);
    assert.match(html, /role="status"/);
  }
});
test('warning gives the recorded deadline and automatic closure offers summary and new-chat recovery', () => {
  const warning = renderToStaticMarkup(
    React.createElement(ChatLifecycleNotice, {
      open: true,
      warningAt: '2026-10-24T19:00:00Z',
      warningDueAt: '2026-10-25T08:00:00Z',
    }),
  );
  assert.match(warning, /Reply before/);
  assert.doesNotMatch(warning, /4 more support hours/);
  const summary = renderToStaticMarkup(
    React.createElement(ChatLifecycleNotice, {
      open: false,
      closedAt: '2026-10-25T08:00:00Z',
      summary: 'Topic: Printer\nLast IT update: Restart <safely>',
    }),
  );
  assert.match(summary, /Chat summary/);
  assert.match(summary, /Restart &lt;safely&gt;/);
  assert.match(summary, /Start a new chat/);
  assert.match(summary, /href="\/app\/chat\?start=1"/);
  assert.equal(renderToStaticMarkup(React.createElement(ChatLifecycleNotice, { open: false })), '');
});
