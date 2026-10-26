import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { verifyWebhookSignature, emailAddress, workspaceSlug, messageBody } = load(
  'src/features/tickets/inbound-email.ts',
  { 'server-only': {} },
);

const key = Buffer.from('test-signing-key-material').toString('base64');
const secret = `whsec_${key}`;
const sign = (id, timestamp, body) =>
  createHmac('sha256', Buffer.from(key, 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64');

test('webhook signatures are verified against the raw body, key and time window', () => {
  const body = '{"type":"email.received"}';
  const now = 1_800_000_000;
  const headers = {
    id: 'msg_1',
    timestamp: String(now),
    signature: `v1,${sign('msg_1', now, body)}`,
  };
  assert.equal(verifyWebhookSignature(secret, headers, body, now), true);
  assert.equal(
    verifyWebhookSignature(
      secret,
      { ...headers, signature: `v1,bogus v1,${sign('msg_1', now, body)}` },
      body,
      now,
    ),
    true,
    'any listed signature may match during key rotation',
  );
  assert.equal(
    verifyWebhookSignature(secret, headers, `${body} `, now),
    false,
    'body tampering fails',
  );
  assert.equal(verifyWebhookSignature(secret, { ...headers, id: 'msg_2' }, body, now), false);
  assert.equal(
    verifyWebhookSignature(secret, headers, body, now + 301),
    false,
    'stale deliveries fail',
  );
  assert.equal(verifyWebhookSignature('not-a-secret', headers, body, now), false);
  assert.equal(verifyWebhookSignature(secret, { ...headers, signature: null }, body, now), false);
});

test('sender and workspace addresses are parsed strictly', () => {
  assert.equal(emailAddress('Jordan Morgan <Jordan@Example.com>'), 'jordan@example.com');
  assert.equal(emailAddress(' it@example.com '), 'it@example.com');
  for (const bad of ['', 'not an email', 'a@b', 42, null]) assert.equal(emailAddress(bad), null);
  assert.equal(
    workspaceSlug(
      ['someone@else.com', 'Northwind <northwind-it@in.fixxflow.app>'],
      'in.fixxflow.app',
    ),
    'northwind-it',
  );
  assert.equal(
    workspaceSlug(['bad_slug@in.fixxflow.app', 'x@in.fixxflow.app.evil.com'], 'in.fixxflow.app'),
    null,
  );
});

test('message bodies drop quoted history and fall back to HTML text', () => {
  assert.equal(
    messageBody(
      'Still broken.\n\nOn Mon, Oct 26, 2026 at 9:00 AM IT <it@x.com> wrote:\n> Try again',
      null,
    ),
    'Still broken.',
  );
  assert.equal(messageBody('Thanks\n> quoted line\nBye', null), 'Thanks\nBye');
  assert.equal(
    messageBody(
      null,
      '<p>Printer &amp; scanner</p><div>jam <b>again</b></div><script>x()</script>',
    ),
    'Printer & scanner\njam again',
  );
  assert.equal(messageBody('x'.repeat(20000), null).length, 19000);
});
