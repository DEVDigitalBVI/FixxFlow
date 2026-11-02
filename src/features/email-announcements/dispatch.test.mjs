import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

test('dispatcher continues beyond ten recipients and leaves unclaimed work when its budget expires', async () => {
  const originalNow = Date.now;
  try {
    for (const sendDuration of [0, 15_000]) {
      let now = 0;
      Date.now = () => now;
      let claimed = 0;
      const acknowledged = [];
      const { dispatchEmailAnnouncements } = load('src/features/email-announcements/dispatch.ts', {
        'node:timers/promises': {
          setTimeout: async (ms) => {
            now += ms;
          },
        },
        '@/features/notifications/configuration': {
          getNotificationEmailConfiguration: () => ({}),
        },
        '@/features/email-announcements/email': {
          sendEmailAnnouncement: async () => {
            now += sendDuration;
            return 'receipt';
          },
        },
        '@/lib/supabase/admin': {
          createAdminClient: () => ({
            rpc: async (name, args) => {
              if (name === 'claim_email_announcements') {
                assert.equal(args.batch_size, 1, 'never lease recipients that cannot start yet');
                if (claimed === 25) return { data: [], error: null };
                claimed++;
                return {
                  data: [
                    { campaign_id: 'campaign', user_id: String(claimed), lease_token: 'lease' },
                  ],
                  error: null,
                };
              }
              acknowledged.push(args.recipient);
              return { data: true, error: null };
            },
          }),
        },
      });
      const result = await dispatchEmailAnnouncements();
      const expected = sendDuration ? 3 : 25;
      assert.deepEqual(result, { processed: expected, sent: expected });
      assert.equal(acknowledged.length, expected);
      assert.equal(claimed, expected);
    }
  } finally {
    Date.now = originalNow;
  }
});
