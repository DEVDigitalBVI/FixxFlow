import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

test('compact chat times retain the full date and viewer timezone in their accessible name', () => {
  const { ChatTime } = load('src/features/chat/chat-time.tsx', {
    '@/features/timezones/provider': { useTimezone: () => 'America/Tortola' },
  });
  const value = '2026-10-18T01:35:00Z';
  const message = renderToStaticMarkup(React.createElement(ChatTime, { value }));
  assert.match(message, /dateTime="2026-10-18T01:35:00Z"/i);
  assert.match(message, /aria-label="Oct 17, 2026(?: at|,) 9:35 PM \(America\/Tortola\)"/);
  assert.match(message, />9:35 PM<\/time>/);
  const inbox = renderToStaticMarkup(React.createElement(ChatTime, { value, variant: 'inbox' }));
  assert.match(inbox, />Oct 17<\/time>/);
  assert.match(inbox, /title="Oct 17, 2026(?: at|,) 9:35 PM/);
});
