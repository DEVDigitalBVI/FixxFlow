import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { safeQueueReturn, ticketDetailHref } = load('src/features/tickets/queue-navigation.ts');
test('detail return preserves queue filters and page while removing panel selection', () => {
  const context = '/app/tickets?view=mine&q=VPN&status=open&sort=oldest&page=3&ticket=id';
  const safe = safeQueueReturn(context);
  assert.equal(safe, '/app/tickets?view=mine&q=VPN&status=open&sort=oldest&page=3');
  assert.equal(
    new URL(ticketDetailHref('ticket', context), 'https://example.test').searchParams.get(
      'returnTo',
    ),
    safe,
  );
});
test('return navigation rejects external, script and unrelated internal destinations', () => {
  for (const value of [
    'https://other.test/app/tickets',
    '//other.test/app/tickets',
    'javascript:alert(1)',
    '/app/people',
    '/app/tickets/other',
  ])
    assert.equal(safeQueueReturn(value), '/app/tickets');
});
