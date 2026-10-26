import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const key = Buffer.from('route-signing-key').toString('base64');
const env = {
  RESEND_API_KEY: 're_test',
  RESEND_INBOUND_WEBHOOK_SECRET: `whsec_${key}`,
  INBOUND_EMAIL_DOMAIN: 'support.fixxflow.com',
};
function signedRequest(payload, { tamper = false } = {}) {
  const body = JSON.stringify(payload);
  const id = 'msg_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', Buffer.from(key, 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');
  return new Request('https://app.example.test/api/inbound/email', {
    method: 'POST',
    headers: { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
    body: tamper ? body.replace('email.received', 'email.receivedX') : body,
  });
}
function setup({ email, rpcError = null, fetchStatus = 200 } = {}) {
  const calls = [];
  const { POST } = load('src/app/api/inbound/email/route.ts', {
    'server-only': {},
    '@/lib/server-errors': { reportServerError: () => 'reference' },
    '@/lib/supabase/admin': {
      createAdminClient: () => ({
        rpc: async (name, args) => {
          calls.push([name, args]);
          return { data: { status: 'ticket_created' }, error: rpcError };
        },
      }),
    },
  });
  globalThis.fetch = async (url, options) => {
    calls.push(['fetch', url, options.headers.Authorization]);
    return new Response(JSON.stringify(email ?? {}), { status: fetchStatus });
  };
  return { POST, calls };
}
const received = {
  type: 'email.received',
  data: { email_id: 'em_123', to: ['Northwind <northwind@support.fixxflow.com>'] },
};
const original = { ...process.env };

test('the inbound webhook verifies, filters and hands authenticated mail to the database', async (t) => {
  t.after(() => {
    process.env = original;
  });
  process.env = { ...original };
  let { POST } = setup();
  assert.equal((await POST(signedRequest(received))).status, 503, 'off until configured');

  process.env = { ...original, ...env };
  ({ POST } = setup());
  assert.equal((await POST(signedRequest(received, { tamper: true }))).status, 401);
  assert.deepEqual(await (await POST(signedRequest({ type: 'email.sent', data: {} }))).json(), {
    ignored: 'event',
  });
  assert.deepEqual(
    await (
      await POST(signedRequest({ ...received, data: { email_id: 'em_1', to: ['x@other.com'] } }))
    ).json(),
    { ignored: 'recipient' },
  );

  const accepted = setup({
    email: {
      from: 'Jordan Morgan <Jordan@Example.com>',
      subject: 'Re: Printer [#1042]',
      text: 'Still jamming\n\nOn Mon, IT wrote:\n> old',
      attachments: [{ id: 'a' }],
      authentication: { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    },
  });
  const response = await accepted.POST(signedRequest(received));
  assert.equal(response.status, 200);
  assert.deepEqual(accepted.calls[0], [
    'fetch',
    'https://api.resend.com/emails/receiving/em_123',
    'Bearer re_test',
  ]);
  assert.deepEqual(accepted.calls[1], [
    'accept_inbound_email',
    {
      provider_id: 'em_123',
      org_slug: 'northwind',
      sender_email: 'jordan@example.com',
      subject: 'Re: Printer [#1042]',
      body: 'Still jamming',
      authenticated: true,
      attachment_count: 1,
    },
  ]);

  const spoofed = setup({
    email: { from: 'ceo@example.com', text: 'Wire money', authentication: { dmarc: 'fail' } },
  });
  await spoofed.POST(signedRequest(received));
  assert.equal(
    spoofed.calls[1][1].authenticated,
    false,
    'failed DMARC is passed through as unauthenticated',
  );

  const legacy = setup({ email: { from: 'a@example.com', text: 'x', authentication: null } });
  await legacy.POST(signedRequest(received));
  assert.equal(legacy.calls[1][1].authenticated, false, 'missing results are not trusted');

  const outage = setup({ fetchStatus: 503 });
  assert.equal((await outage.POST(signedRequest(received))).status, 502, 'Resend retries outages');
});
