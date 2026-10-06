import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';

const environment = {
  ZOHO_CPAAS_API_KEY: 'fixture-token',
  NOTIFICATIONS_FROM_EMAIL: 'FixxFlow <notifications@example.test>',
  NEXT_PUBLIC_SITE_URL: 'https://app.example.test',
  CRON_SECRET: 'fixture-cron-secret',
  SUPABASE_SECRET_KEY: 'fixture-server-key',
};
const items = [1, 2].map(id => ({ notification_id: `notice-${id}`, lease_token: `lease-${id}` }));

async function dispatch({ batch = items, send = async () => 'provider-id', rpcError, acknowledgement = true } = {}) {
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  const calls = [];
  const failures = [];
  try {
    Object.assign(process.env, environment);
    const { GET } = load('src/app/api/cron/notifications/route.ts', {
      '@/lib/server-errors': { reportServerError: (...args) => failures.push(args) },
      '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === rpcError) return { error: new Error('private database details') };
        if (name === 'enqueue_sla_notifications') return { data: null, error: null };
        if (name === 'claim_notification_emails') {
          assert.deepEqual(args, { batch_size: 5 });
          return { data: batch, error: null };
        }
        assert.equal(name, 'finish_notification_email');
        return { data: acknowledgement, error: null };
      } }) },
      '@/features/notifications/email': { sendNotificationEmail: async (item, config) => {
        calls.push({ name: 'send', item });
        assert.equal(config.apiKey, environment.ZOHO_CPAAS_API_KEY);
        return send(item);
      } },
    });
    const response = await GET(new Request('https://app.example.test/api/cron/notifications', {
      headers: { authorization: `Bearer ${environment.CRON_SECRET}` },
    }));
    return { status: response.status, reference: response.headers.get('X-Correlation-ID'), body: await response.json(), calls, failures };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('empty email queue returns success without sending or acknowledging mail', async () => {
  const result = await dispatch({ batch: [] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { processed: 0, sent: 0 });
  assert.deepEqual(result.calls.map(call => call.name), ['enqueue_sla_notifications', 'claim_notification_emails']);
  assert.ok(result.reference);
});

test('provider failure schedules a sanitized retry and continues the remaining batch', async () => {
  const result = await dispatch({ send: async item => {
    if (item.notification_id === items[0].notification_id) throw new Error('private provider token and recipient');
    return 'provider-second';
  } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { processed: 2, sent: 1 });
  const acknowledgements = result.calls.filter(call => call.name === 'finish_notification_email');
  assert.deepEqual(acknowledgements.map(call => call.args), [
    { target_id: 'notice-1', token: 'lease-1', provider_message_id: undefined, failure: 'Email delivery failed; scheduled for retry' },
    { target_id: 'notice-2', token: 'lease-2', provider_message_id: 'provider-second', failure: undefined },
  ]);
  assert.equal(result.failures[0][0], 'notification.send');
  assert.equal(result.failures[0][2], result.reference);
  assert.doesNotMatch(JSON.stringify(result.body), /private/);
});

for (const rpcError of ['enqueue_sla_notifications', 'claim_notification_emails']) {
  test(`${rpcError} failure returns a safe error before sending mail`, async () => {
    const result = await dispatch({ rpcError });
    assert.equal(result.status, 500);
    assert.equal(result.calls.some(call => call.name === 'send'), false);
    assert.deepEqual(result.body, { error: 'Notification processing failed', reference: result.reference });
    assert.equal(result.failures[0][0], 'notification.dispatch');
  });
}

for (const options of [{ acknowledgement: false }, { rpcError: 'finish_notification_email' }]) {
  test(`failed queue acknowledgement (${JSON.stringify(options)}) stops sending and reports failure`, async () => {
    const result = await dispatch(options);
    assert.equal(result.status, 500);
    assert.deepEqual(result.calls.filter(call => call.name === 'send').map(call => call.item), [items[0]]);
    assert.deepEqual(result.body, { error: 'Notification processing failed', reference: result.reference });
    assert.equal(result.failures[0][2], result.reference);
  });
}
