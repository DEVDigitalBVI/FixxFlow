import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';

const { getNotificationEmailConfiguration } = load('src/features/notifications/configuration.ts');
const environment = {
  ZOHO_CPAAS_API_KEY: 'fixture-zoho-token',
  NOTIFICATIONS_FROM_EMAIL: 'FixxFlow <support@example.test>',
  NEXT_PUBLIC_SITE_URL: 'https://app.example.test',
  CRON_SECRET: 'fixture-cron-secret',
  SUPABASE_SECRET_KEY: 'fixture-server-key',
};

test('notification readiness requires each dispatcher setting and ignores legacy Resend credentials', () => {
  assert.deepEqual(getNotificationEmailConfiguration(environment), {
    apiKey: environment.ZOHO_CPAAS_API_KEY, from: environment.NOTIFICATIONS_FROM_EMAIL, siteUrl: environment.NEXT_PUBLIC_SITE_URL,
  });
  for (const key of Object.keys(environment)) {
    for (const missing of [undefined, '', '   ']) {
      assert.equal(getNotificationEmailConfiguration({ ...environment, [key]: missing, RESEND_API_KEY: 'legacy-token' }), null, key);
    }
  }
});

test('readiness rejects settings that email delivery would reject', () => {
  for (const siteUrl of ['not a URL', 'http://localhost:3000', 'https://user:password@example.test']) {
    assert.equal(getNotificationEmailConfiguration({ ...environment, NEXT_PUBLIC_SITE_URL: siteUrl }), null);
  }
  for (const from of ['invalid', 'support@example.test\r\nBcc: hidden@example.test']) {
    assert.equal(getNotificationEmailConfiguration({ ...environment, NOTIFICATIONS_FROM_EMAIL: from }), null);
  }
});

test('authorized cron rejects incomplete configuration before accessing the queue', async () => {
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, environment);
    const { GET } = load('src/app/api/cron/notifications/route.ts', {
      '@/lib/supabase/admin': { createAdminClient() { throw Error('Invalid configuration must not claim mail'); } },
      '@/features/notifications/email': { sendNotificationEmail() { throw Error('Must not send mail'); } },
    });
    for (const key of Object.keys(environment).filter(key => key !== 'CRON_SECRET')) {
      delete process.env[key];
      const response = await GET(new Request('https://app.example.test/api/cron/notifications', {
        headers: { authorization: `Bearer ${environment.CRON_SECRET}` },
      }));
      assert.equal(response.status, 503, key);
      assert.deepEqual(await response.json(), { error: 'Email delivery is not configured' });
      process.env[key] = environment[key];
    }
    process.env.NEXT_PUBLIC_SITE_URL = 'http://app.example.test';
    const invalid = await GET(new Request('https://app.example.test/api/cron/notifications', {
      headers: { authorization: `Bearer ${environment.CRON_SECRET}` },
    }));
    assert.equal(invalid.status, 503);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('configured cron sends and acknowledges queued mail using the shared configuration', async () => {
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, environment);
    const item = { notification_id: 'fixture-notification', lease_token: 'fixture-lease' };
    const calls = [];
    const { GET } = load('src/app/api/cron/notifications/route.ts', {
      '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async (name, args) => {
        calls.push(name);
        if (name === 'enqueue_sla_notifications') return { data: null, error: null };
        if (name === 'claim_notification_emails') return { data: [item], error: null };
        assert.equal(name, 'finish_notification_email');
        assert.deepEqual(args, {
          target_id: item.notification_id, token: item.lease_token,
          provider_message_id: 'fixture-message', failure: undefined,
        });
        return { data: true, error: null };
      } }) },
      '@/features/notifications/email': { sendNotificationEmail: async (queued, config) => {
        assert.deepEqual(queued, item);
        assert.deepEqual(config, getNotificationEmailConfiguration(environment));
        calls.push('send');
        return 'fixture-message';
      } },
    });
    const response = await GET(new Request('https://app.example.test/api/cron/notifications', {
      headers: { authorization: `Bearer ${environment.CRON_SECRET}` },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ['enqueue_sla_notifications', 'claim_notification_emails', 'send', 'finish_notification_email']);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
