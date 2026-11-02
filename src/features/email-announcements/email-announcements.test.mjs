import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const announcementId = '72000000-0000-4000-8000-000000000001';
const config = {
  apiKey: 'fixture',
  from: 'IT <it@example.invalid>',
  siteUrl: 'https://fixxflow.com',
};
const campaign = {
  id: announcementId,
  subject: 'Email IT for help',
  body: 'Use your work email.\nKeep passwords private.',
  created_at: '2026-11-02T12:00:00Z',
  queued_at: null,
};
const review = {
  campaign,
  counts: { total: 1, pending: 1, sent: 0, failed: 0, skipped: 0 },
  recipients: [
    {
      user_id: 'employee',
      display_name: 'Employee <script>',
      email: 'employee@example.invalid',
      status: 'pending',
    },
  ],
};
function actions(role = 'administrator', error = null, configured = true) {
  const calls = [];
  const api = load('src/app/app/administration/announcements/actions.ts', {
    'next/cache': { revalidatePath: (path) => calls.push(['refresh', path]) },
    '@/lib/auth/viewer': {
      requireWorkspaceAccess: async () => ({ role, organizationId: 'trusted-org' }),
    },
    '@/lib/server-errors': { reportServerError: () => 'reference' },
    '@/features/notifications/configuration': {
      getNotificationEmailConfiguration: () => (configured ? config : null),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push([name, args]);
          return { data: name === 'prepare_email_announcement' ? announcementId : 1, error };
        },
      }),
    },
  });
  return { ...api, calls };
}
function form(extra = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    submissionKey: announcementId,
    subject: campaign.subject,
    body: campaign.body,
    audience: 'all',
    ...extra,
  }))
    data.set(key, value);
  return data;
}
test('draft preparation validates input, trusts the session tenant and never queues email', async () => {
  const api = actions();
  const result = await api.prepareEmailAnnouncement(form({ organizationId: 'forged-org' }));
  assert.equal(result.redirectTo, `/app/administration/announcements/${announcementId}`);
  assert.deepEqual(api.calls[0], [
    'prepare_email_announcement',
    {
      org: 'trusted-org',
      token: announcementId,
      heading: campaign.subject,
      message: campaign.body,
      selected_members: null,
    },
  ]);
  assert.ok(!api.calls.some((c) => c[0] === 'queue_email_announcement'));
  for (const values of [
    { subject: 'x' },
    { body: 'x' },
    { subject: 'Header\nInjected' },
    { submissionKey: 'bad' },
  ]) {
    const invalid = actions();
    assert.ok((await invalid.prepareEmailAnnouncement(form(values))).error);
    assert.equal(invalid.calls.length, 0);
  }
  for (const role of ['technician', 'end_user']) {
    const denied = actions(role);
    assert.ok((await denied.prepareEmailAnnouncement(form())).error);
    assert.equal(denied.calls.length, 0);
  }
});
test('sending requires review confirmation, administrator access and configured email delivery', async () => {
  for (const [role, configured, confirm] of [
    ['administrator', true, ''],
    ['end_user', true, 'yes'],
    ['administrator', false, 'yes'],
  ]) {
    const api = actions(role, null, configured);
    assert.ok((await api.queueEmailAnnouncement(form({ announcementId, confirm }))).error);
    assert.equal(api.calls.length, 0);
  }
  const api = actions();
  const result = await api.queueEmailAnnouncement(
    form({ announcementId, confirm: 'yes', recipients: 'attacker@example.invalid' }),
  );
  assert.match(result.success, /queued for 1/);
  assert.deepEqual(api.calls[0], [
    'queue_email_announcement',
    { org: 'trusted-org', target: announcementId },
  ]);
  for (const code of ['PT422', 'PT409', '08006']) {
    const failing = actions('administrator', { code });
    assert.ok(
      (await failing.queueEmailAnnouncement(form({ announcementId, confirm: 'yes' }))).error,
    );
  }
});
test('email announcement rendering escapes text, preserves lines and sends privately with a stable retry key', async () => {
  const { sendEmailAnnouncement } = load('src/features/email-announcements/email.ts');
  const item = {
    campaign_id: announcementId,
    user_id: 'employee',
    lease_token: 'lease-1',
    recipient_email: 'employee@example.invalid',
    subject: 'A <script> subject',
    body: 'First line\n<script>never execute</script>',
    workspace_name: 'Example workspace',
  };
  const keys = [];
  for (const lease_token of ['lease-1', 'lease-2']) {
    assert.equal(
      await sendEmailAnnouncement({ ...item, lease_token }, config, async (url, options) => {
        assert.equal(url, 'https://api.resend.com/emails');
        const payload = JSON.parse(options.body);
        assert.deepEqual(payload.to, ['employee@example.invalid']);
        assert.equal(payload.cc, undefined);
        assert.equal(payload.bcc, undefined);
        assert.match(payload.text, /First line\n<script>/);
        assert.match(payload.html, /&lt;script&gt;/);
        assert.doesNotMatch(payload.html, /<script>/);
        assert.match(payload.html, /Example workspace/);
        keys.push(options.headers['Idempotency-Key']);
        return Response.json({ id: 'provider-receipt' });
      }),
      'provider-receipt',
    );
  }
  assert.equal(keys[0], keys[1]);
  await assert.rejects(
    sendEmailAnnouncement(item, config, async () => Response.json({}, { status: 429 })),
    /provider request failed/,
  );
  await assert.rejects(
    sendEmailAnnouncement(item, config, async () => Response.json({})),
    /Missing email receipt/,
  );
});
function page(role = 'administrator', data = review) {
  const mocks = {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': {
      notFound: () => {
        throw Error('NOT_FOUND');
      },
    },
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children, disabled }) =>
        React.createElement('button', { type: 'submit', disabled }, children),
    },
    '@/components/ui/submission-key': {
      SubmissionKey: () =>
        React.createElement('input', {
          type: 'hidden',
          name: 'submissionKey',
          value: announcementId,
        }),
    },
    '@/components/ui/retry-button': {
      RetryButton: ({ label }) => React.createElement('button', null, label),
    },
    '@/features/timezones/provider': { Timestamp: ({ value }) => value },
    '@/lib/auth/viewer': {
      requireWorkspaceAccess: async () => ({ role, organizationId: 'trusted-org' }),
    },
    '@/features/notifications/configuration': { getNotificationEmailConfiguration: () => config },
    '../actions': { queueEmailAnnouncement: async () => ({}) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          assert.equal(name, 'read_email_announcements');
          assert.equal(args.org, 'trusted-org');
          return { data, error: null };
        },
      }),
    },
  };
  return load('src/app/app/administration/announcements/[announcementId]/page.tsx', mocks).default;
}
test('review shows message, escaped recipients and an explicit required confirmation before send', async () => {
  const Page = page();
  const html = renderToStaticMarkup(
    await Page({ params: Promise.resolve({ announcementId }), searchParams: Promise.resolve({}) }),
  );
  assert.match(html, /Review email announcement/);
  assert.match(html, /Draft only/);
  assert.match(html, /Employee &lt;script&gt;/);
  assert.match(html, /<input(?=[^>]*name="confirm")(?=[^>]*required)[^>]*>/);
  assert.match(html, /Send announcement to 1 member/);
  assert.match(html, /aria-labelledby="email-recipients-heading"/);
  for (const role of ['technician', 'end_user'])
    await assert.rejects(
      page(role)({
        params: Promise.resolve({ announcementId }),
        searchParams: Promise.resolve({}),
      }),
      /NOT_FOUND/,
    );
});
test('queued emails show progress without another send action and retain recipient paging', async () => {
  const Page = page('administrator', {
    ...review,
    campaign: { ...campaign, queued_at: '2026-11-02T12:05:00Z' },
    counts: { ...review.counts, total: 51, pending: 49, failed: 1, sent: 1 },
  });
  const html = renderToStaticMarkup(
    await Page({ params: Promise.resolve({ announcementId }), searchParams: Promise.resolve({}) }),
  );
  assert.match(html, /Announcement progress/);
  assert.match(html, /1 sent · 49 pending · 1 failed/);
  assert.match(html, /Refresh progress/);
  assert.match(html, /aria-label="Recipient pages"/);
  assert.doesNotMatch(html, /name="confirm"|Send announcement to/);
});

test('email worker is cron-only and acknowledges both sent mail and retryable failures', async () => {
  for (const options of [
    { authorized: false },
    { configured: false },
    {},
    { failSend: true },
    { failAck: true },
  ]) {
    const calls = [];
    const delivery = {
      campaign_id: announcementId,
      user_id: 'employee',
      lease_token: 'lease',
      recipient_email: 'employee@example.invalid',
    };
    const { GET } = load('src/app/api/cron/email-announcements/route.ts', {
      '@/lib/cron-auth': { isCronAuthorized: () => options.authorized !== false },
      '@/features/notifications/configuration': {
        getNotificationEmailConfiguration: () => (options.configured === false ? null : config),
      },
      '@/features/email-announcements/email': {
        sendEmailAnnouncement: async () => {
          calls.push(['send']);
          if (options.failSend) throw Error('provider down');
          return 'receipt';
        },
      },
      '@/lib/server-errors': { reportServerError: () => 'reference' },
      '@/lib/supabase/admin': {
        createAdminClient: () => ({
          rpc: async (name, args) => {
            calls.push([name, args]);
            return name === 'claim_email_announcements'
              ? { data: [delivery], error: null }
              : { data: !options.failAck, error: null };
          },
        }),
      },
    });
    const response = await GET(new Request('https://fixture.invalid/api/cron/email-announcements'));
    assert.equal(
      response.status,
      options.authorized === false
        ? 401
        : options.configured === false
          ? 503
          : options.failAck
            ? 500
            : 200,
    );
    if (options.authorized === false || options.configured === false) assert.equal(calls.length, 0);
    else {
      const ack = calls.find((c) => c[0] === 'finish_email_announcement')[1];
      assert.deepEqual(ack, {
        campaign: announcementId,
        recipient: 'employee',
        token: 'lease',
        provider_id: options.failSend ? undefined : 'receipt',
        failure: Boolean(options.failSend),
      });
    }
  }
});

test('announcement composer starts blank, includes all member roles and guards administrator access', async () => {
  for (const role of ['administrator', 'end_user']) {
    const Page = load('src/app/app/administration/announcements/page.tsx', {
      'next/link': {
        default: ({ children, ...props }) => React.createElement('a', props, children),
      },
      'next/navigation': {
        notFound: () => {
          throw Error('NOT_FOUND');
        },
      },
      '@/components/ui/action-form': {
        ActionForm: ({ children }) => React.createElement('form', null, children),
      },
      '@/components/ui/submit-button': {
        SubmitButton: ({ children }) => React.createElement('button', { type: 'submit' }, children),
      },
      '@/components/ui/submission-key': {
        SubmissionKey: () =>
          React.createElement('input', {
            type: 'hidden',
            name: 'submissionKey',
            value: announcementId,
          }),
      },
      '@/features/timezones/provider': { Timestamp: ({ value }) => value },
      '@/lib/auth/viewer': {
        requireViewer: async () => ({
          role,
          organizationId: 'trusted-org',
          organizationName: 'Example workspace',
        }),
      },
      '@/features/notifications/configuration': {
        getNotificationEmailConfiguration: () => config,
        getInboundEmailConfiguration: () => ({ domain: 'inbound.example.invalid' }),
        inboundAddress: (slug, domain) => `${slug}@${domain}`,
      },
      './actions': { prepareEmailAnnouncement: async () => ({}) },
      '@/lib/supabase/server': {
        createClient: async () => ({
          rpc: async (name, args) => {
            assert.equal(args.org, 'trusted-org');
            return {
              data:
                name === 'email_announcement_choices'
                  ? { total: 0, rows: [] }
                  : { total: 0, campaigns: [] },
              error: null,
            };
          },
          from: () => {
            const builder = {
              select: () => builder,
              eq: (_, id) => {
                assert.equal(id, 'trusted-org');
                return builder;
              },
              single: async () => ({ data: { slug: 'example-workspace' }, error: null }),
            };
            return builder;
          },
        }),
      },
    }).default;
    const props = { searchParams: Promise.resolve({}) };
    if (role !== 'administrator') {
      await assert.rejects(Page(props), /NOT_FOUND/);
      continue;
    }
    const html = renderToStaticMarkup(await Page(props));
    assert.doesNotMatch(html, /email-to-ticket|inbound.example.invalid|Use email-to-ticket/);
    assert.match(html, /including employees, technicians and administrators/);
    assert.match(html, /Review announcement &amp; recipients/);
    assert.match(html, /Nothing is sent until you review/);
    assert.match(html, /<label for="email-announcement-subject">Subject/);
    assert.match(html, /<label for="email-announcement-body">Message/);
    assert.match(html, /Pending invitations and inactive/);
    assert.doesNotMatch(html, /Send announcement to/);
  }
});
