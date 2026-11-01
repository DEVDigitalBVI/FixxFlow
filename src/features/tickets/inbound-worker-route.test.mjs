import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

test('attachment cron requires authorization, stays disabled without configuration and reports recoverable failure', async () => {
  let authorized = false,
    configured = false,
    fail = false,
    calls = 0;
  const { GET } = load('src/app/api/cron/inbound-email/route.ts', {
    '@/lib/cron-auth': { isCronAuthorized: () => authorized },
    '@/features/notifications/configuration': {
      getInboundEmailConfiguration: () => (configured ? { apiKey: 'fixture' } : null),
    },
    '@/features/tickets/inbound-attachments': {
      processInboundAttachments: async () => {
        calls++;
        if (fail) throw Error('Private failure');
        return { processed: 1 };
      },
    },
    '@/lib/server-errors': { reportServerError: () => 'reference' },
  });
  const request = new Request('https://example.test/api/cron/inbound-email');
  assert.equal((await GET(request)).status, 401);
  assert.equal(calls, 0);
  authorized = true;
  assert.equal((await (await GET(request)).json()).disabled, true);
  assert.equal(calls, 0);
  configured = true;
  assert.equal((await (await GET(request)).json()).processed, 1);
  fail = true;
  const response = await GET(request);
  assert.equal(response.status, 500);
  assert.doesNotMatch(JSON.stringify(await response.json()), /Private failure/);
});
