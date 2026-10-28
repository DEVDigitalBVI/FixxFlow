import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { digestContent, sendNotificationDigest } = load(
  'src/features/notifications/digest-email.ts',
);
const item = {
  digest_id: 'digest-1',
  recipient_email: 'employee@example.invalid',
  workspace_name: 'Sample IT',
  items: [{ title: '<script>private</script>', href: '/app/notifications' }],
  total: 1,
  local_day: '2026-10-27',
};
const config = {
  apiKey: 'fixture',
  from: 'FixxFlow <no-reply@example.invalid>',
  siteUrl: 'https://fixxflow.com',
};
test('daily summary uses the shared compact email shell, escapes titles and caps visible items', () => {
  const content = digestContent(item, config.siteUrl);
  assert.match(content.html, /&lt;script&gt;/);
  assert.ok(!content.html.includes('<script>'));
  assert.match(content.text, /1 update is/);
  const large = digestContent(
    {
      ...item,
      total: 12,
      items: Array.from({ length: 12 }, (_, n) => ({ title: `Notice ${n + 1}` })),
    },
    config.siteUrl,
  );
  assert.match(large.text, /And 2 more/);
  assert.ok(!large.text.includes('Notice 11'));
  assert.throws(() => digestContent({ ...item, total: 0, items: [] }, config.siteUrl));
});
test('digest retries retain one provider idempotency key; failed or missing provider IDs never count as delivered', async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ id: 'provider' }) };
  };
  assert.equal(await sendNotificationDigest(item, config, fetcher), 'provider');
  await sendNotificationDigest(item, config, fetcher);
  assert.equal(calls[0].init.headers['Idempotency-Key'], calls[1].init.headers['Idempotency-Key']);
  assert.equal(calls[0].init.body, calls[1].init.body);
  assert.equal(JSON.parse(calls[0].init.body).to[0], item.recipient_email);
  await assert.rejects(sendNotificationDigest(item, config, async () => ({ ok: false })));
  await assert.rejects(
    sendNotificationDigest(item, config, async () => ({ ok: true, json: async () => ({}) })),
  );
});
test('digest cron rejects unauthorized requests before database access and acknowledges failed sends for retry', async () => {
  const calls = [];
  let allowed = false;
  const { GET } = load('src/app/api/cron/notification-digests/route.ts', {
    '@/lib/cron-auth': { isCronAuthorized: () => allowed },
    '@/features/notifications/configuration': { getNotificationEmailConfiguration: () => config },
    '@/features/notifications/digest-email': {
      sendNotificationDigest: async () => {
        throw Error('Provider secret');
      },
    },
    '@/lib/server-errors': { reportServerError() {} },
    '@/lib/supabase/admin': {
      createAdminClient: () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return name === 'claim_notification_digests'
            ? { data: [{ ...item, lease_token: 'lease' }], error: null }
            : { data: true, error: null };
        },
      }),
    },
  });
  assert.equal(
    (await GET(new Request('https://fixxflow.com/api/cron/notification-digests'))).status,
    401,
  );
  assert.equal(calls.length, 0);
  allowed = true;
  const response = await GET(new Request('https://fixxflow.com/api/cron/notification-digests'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { processed: 1, sent: 0 });
  assert.equal(calls[1].args.failure, true);
  assert.equal(calls[1].args.provider_message_id, null);
});
