import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const id = '72000000-0000-4000-8000-000000000001';
const pending = { total: 2, pending: 2, sent: 0, failed: 0, skipped: 0 };
const sent = { total: 2, pending: 0, sent: 2, failed: 0, skipped: 0 };
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

test('automatic return waits for confirmed sent status, preserving the progress page on failure', async () => {
  const oldFetch = globalThis.fetch,
    oldInterval = globalThis.setInterval,
    oldClear = globalThis.clearInterval;
  let tick;
  globalThis.setInterval = (callback, interval) => {
    assert.equal(interval, 2000);
    tick = callback;
    return 1;
  };
  globalThis.clearInterval = () => {};
  try {
    for (const result of [
      pending,
      { ...sent, sent: 1, failed: 1 },
      { ...sent, sent: 0, skipped: 2 },
      sent,
      null,
    ]) {
      let current = result;
      const navigation = [];
      const router = { replace: (path) => navigation.push(path) };
      globalThis.fetch = async () => {
        if (current === null) throw Error('offline');
        return Response.json({ queued: true, counts: current });
      };
      const ui = componentHarness(
        'src/features/email-announcements/delivery-progress.tsx',
        'AnnouncementDeliveryProgress',
        {
          announcementId: id,
          queuedAt: '2026-11-02T12:00:00Z',
          initialCounts: pending,
          returnWhenSent: true,
        },
        {
          'next/navigation': { useRouter: () => router },
          '@/features/timezones/provider': { Timestamp: ({ value }) => value },
        },
      );
      try {
        await pause();
        ui.render();
        assert.equal(navigation.length, result === sent ? 1 : 0);
        if (result === pending || result === null) {
          current = sent;
          tick();
          await pause();
          ui.render();
          assert.deepEqual(navigation, [`/app/administration/announcements?sent=${id}`]);
        }
        tick();
        await pause();
        ui.render();
        assert.equal(
          navigation.length,
          result === pending || result === null || result === sent ? 1 : 0,
          'only successful sending returns, and only once',
        );
      } finally {
        ui.close();
      }
    }
    const navigation = [];
    globalThis.fetch = async () => Response.json({ queued: true, counts: sent });
    const router = { replace: (path) => navigation.push(path) };
    const history = componentHarness(
      'src/features/email-announcements/delivery-progress.tsx',
      'AnnouncementDeliveryProgress',
      {
        announcementId: id,
        queuedAt: '2026-11-02T12:00:00Z',
        initialCounts: sent,
        returnWhenSent: false,
      },
      {
        'next/navigation': { useRouter: () => router },
        '@/features/timezones/provider': { Timestamp: ({ value }) => value },
      },
    );
    try {
      await pause();
      history.render();
      assert.equal(navigation.length, 0, 'history remains reviewable');
    } finally {
      history.close();
    }
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.setInterval = oldInterval;
    globalThis.clearInterval = oldClear;
  }
});

test('delivery status endpoint verifies company access and returns only counts', async () => {
  for (const role of ['administrator', 'technician']) {
    const calls = [];
    const { GET } = load(
      'src/app/app/administration/announcements/[announcementId]/status/route.ts',
      {
        'next/navigation': { unstable_rethrow: () => {} },
        '@/lib/auth/viewer': {
          requireWorkspaceAccess: async () => ({ role, organizationId: 'trusted-org' }),
        },
        '@/lib/server-errors': { reportServerError: () => {} },
        '@/lib/supabase/server': {
          createClient: async () => ({
            rpc: async (name, args) => {
              calls.push([name, args]);
              return {
                data: {
                  campaign: { queued_at: '2026-11-02' },
                  counts: sent,
                  recipients: [{ email: 'private@example.invalid' }],
                },
                error: null,
              };
            },
          }),
        },
      },
    );
    const response = await GET(new Request('https://fixture.invalid'), {
      params: Promise.resolve({ announcementId: id }),
    });
    assert.equal(response.status, role === 'administrator' ? 200 : 403);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    if (role === 'administrator') {
      assert.deepEqual(await response.json(), { queued: true, counts: sent });
      assert.deepEqual(calls, [['read_email_announcements', { org: 'trusted-org', target: id }]]);
    } else assert.equal(calls.length, 0);
  }
});
