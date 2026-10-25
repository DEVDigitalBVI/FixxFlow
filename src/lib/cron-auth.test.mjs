import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../tests/helpers/load-module.mjs';

const { isCronAuthorized } = load('src/lib/cron-auth.ts');
test('cron authorization requires a configured secret and an exact bearer token', () => {
  const request = (authorization) =>
    new Request('https://app.example.test/api/cron', {
      headers: authorization ? { authorization } : {},
    });
  assert.equal(isCronAuthorized(request('Bearer secret'), ''), false);
  for (const value of [
    '',
    'secret',
    'Bearer wrong!',
    'bearer secret',
    'Bearer secreu',
    'Bearer secret extra',
  ])
    assert.equal(isCronAuthorized(request(value), 'secret'), false);
  assert.equal(isCronAuthorized(request('Bearer secret'), 'secret'), true);
});
