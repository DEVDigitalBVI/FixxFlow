import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { sendNotificationEmail } = load('src/features/notifications/email.ts');
const item = {
  notification_id: 'notice-1',
  recipient_email: 'recipient@example.test',
  title: 'Ticket #1 resolved',
  ticket_id: 'ticket-1',
  conversation_id: null,
};
const config = {
  apiKey: 'mock-key',
  from: 'FixxFlow <support@example.test>',
  siteUrl: 'https://example.test',
};
const { renderEmail } = load('src/features/notifications/template.ts');

test('all email variants share a compact header and left-aligned content', () => {
  const emails = fs
    .readdirSync('supabase/templates')
    .filter((name) => name.endsWith('.html'))
    .map((file) => [file, fs.readFileSync(`supabase/templates/${file}`, 'utf8')]);
  for (const purpose of ['notification', 'workspace', 'account-access', 'security-alert']) {
    emails.push([
      purpose,
      renderEmail({
        title: 'Workspace update',
        message: 'Your update is ready.',
        purpose,
        action: 'View update',
        href: 'https://example.test/update',
        note: 'Contact support for help.',
      }),
    ]);
  }
  for (const [name, html] of emails) {
    assert.match(
      html,
      /<td align="left" style="padding:20px 24px 24px;text-align:left;overflow-wrap:anywhere">/,
      name,
    );
    assert.match(
      html,
      /<p style="margin:0 0 8px;color:#545b62;font-size:14px;line-height:22px;font-weight:500">/,
      name,
    );
    assert.match(html, /<p style="margin:0 0 20px;color:#212529;">/, name);
    assert.match(
      html,
      /<td align="left" style="text-align:left;padding:16px 24px;border-top:/,
      name,
    );
    assert.match(html, /width="100%"[^>]*style="max-width:560px/, name);
    assert.match(html, /max-width:560px;background:#ffffff;border:0;border-radius:16px/, name);
    assert.doesNotMatch(html, /border:1px solid #795500/, name);
    assert.match(html, /fixxflow-logo-horizontal\.png[^>]*width="136"/, name);
    assert.doesNotMatch(
      html,
      /Button not working\?|Copy this link|Here to help|IT support in motion/,
      name,
    );
    if (html.includes('>open this link</a>')) {
      assert.match(html, /<table role="presentation" style="margin:0"/, name);
      assert.match(html, /padding:10px 18px/, name);
    }
    if (html.includes('Security notice'))
      assert.match(html, /<td align="left" bgcolor="#fff8cc" style="text-align:left;/, name);
  }
});

test('invitation leads with inviter and workspace, then the action, then one role sentence', () => {
  const html = fs.readFileSync('supabase/templates/invite-user.html', 'utf8');
  assert.match(html, /\{\{ \.Data.invited_by \}\}/);
  assert.match(html, /\{\{ \.Data.workspace_name \}\}/);
  assert.doesNotMatch(html, /What you can do|brings your team’s IT support into one place/);
  const branches = html.match(
    /\{\{ if eq \.Data.invitation_role "administrator" \}\}([\s\S]*?)\{\{ else if eq \.Data.invitation_role "technician" \}\}([\s\S]*?)\{\{ else \}\}([\s\S]*?)\{\{ end \}\}/,
  );
  assert.ok(branches, 'Role branches include an employee fallback for missing metadata');
  for (const branch of branches.slice(1)) {
    assert.doesNotMatch(branch, /<a |<ul|<li/);
    assert.ok(branch.length < 160, 'each role note is one short sentence');
  }
  assert.match(branches[1], /manage workspace access/);
  assert.match(branches[2], /internal notes/);
  assert.match(branches[3], /submit IT requests/);
  const invited = html.indexOf('invited you');
  const action = html.indexOf('>Accept invitation</a>');
  const role = html.indexOf('As an administrator');
  assert.ok(invited > 0 && invited < action, 'inviter and workspace come before the action');
  assert.ok(action < role, 'the role note follows the action');
  assert.doesNotMatch(
    fs.readFileSync('supabase/templates/reset-password.html', 'utf8'),
    /invited you|As an administrator/,
  );
});

test('security guidance is distinguished by a written heading and preserves escaped content', () => {
  const html = renderEmail({
    title: 'Password changed',
    message: 'Your password changed.',
    purpose: 'security-alert',
    note: 'Contact support <script>alert(1)</script> & reset your password.',
  });
  assert.match(html, /Account security/);
  assert.match(html, /<h2[^>]*>Security notice<\/h2>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; reset/);
  assert.doesNotMatch(html, /<script>/);
  const notification = renderEmail({
    title: 'New reply',
    message: 'Open your workspace.',
    note: 'Sign in to view.',
  });
  assert.match(notification, /IT update/);
  assert.doesNotMatch(notification, /Security notice/);
});

test('generated email purposes keep invitations distinct from security changes', () => {
  for (const file of ['confirm-sign-up', 'invite-user']) {
    const html = fs.readFileSync(`supabase/templates/${file}.html`, 'utf8');
    assert.match(html, /Your workspace/);
    assert.doesNotMatch(html, /Security notice/);
  }
  for (const file of [
    'reset-password',
    'magic-link-or-otp',
    'change-email-address',
    'reauthentication',
  ]) {
    assert.match(fs.readFileSync(`supabase/templates/${file}.html`, 'utf8'), /Account access/);
  }
  for (const file of [
    'password-changed',
    'email-address-changed',
    'phone-number-changed',
    'sign-in-method-linked',
    'sign-in-method-removed',
    'mfa-method-added',
    'mfa-method-removed',
  ]) {
    const html = fs.readFileSync(`supabase/templates/${file}.html`, 'utf8');
    assert.match(html, /Account security/);
    assert.match(html, /<h2[^>]*>Security notice<\/h2>/);
  }
});

test('auth templates retain Supabase tokens and accessible email branding', () => {
  for (const file of fs
    .readdirSync('supabase/templates')
    .filter((name) => name.endsWith('.html'))) {
    const html = fs.readFileSync(`supabase/templates/${file}`, 'utf8');
    assert.match(html, /<html lang="en">/);
    assert.match(html, /alt="FixxFlow/);
    assert.match(html, /role="presentation"/);
    assert.match(html, /mailto:support@fixxflow.app/);
    assert.doesNotMatch(html, /<script|onerror=/i);
    if (
      [
        'reset-password.html',
        'confirm-sign-up.html',
        'magic-link-or-otp.html',
        'change-email-address.html',
      ].includes(file)
    )
      assert.match(html, /href="\{\{ \.ConfirmationURL \}\}"/);
    if (file === 'invite-user.html') {
      assert.match(
        html,
        /href="\{\{ \.SiteURL \}\}\/auth\/callback\?token_hash=\{\{ \.TokenHash \}\}&amp;type=invite"/,
      );
      assert.doesNotMatch(html, /\.ConfirmationURL/);
    }
    if (file === 'reauthentication.html') assert.match(html, /\{\{ \.Token \}\}/);
  }
});
test('Resend receives an idempotency key and authenticated link without conversation content', async () => {
  let sent;
  assert.equal(
    await sendNotificationEmail(item, config, async (url, options) => {
      sent = { url, ...options };
      return Response.json({ id: 'provider-1' });
    }),
    'provider-1',
  );
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.equal(sent.headers.Authorization, 'Bearer mock-key');
  const body = JSON.parse(sent.body);
  assert.deepEqual(body.to, ['recipient@example.test']);
  assert.equal(sent.headers['Idempotency-Key'], 'notification/notice-1');
  assert.equal(body.from, 'FixxFlow <support@example.test>');
  assert.equal(body.reply_to, 'support@fixxflow.app');
  assert.deepEqual(Object.keys(body).sort(), ['from', 'html', 'reply_to', 'subject', 'text', 'to']);
  assert.match(body.text, /https:\/\/example.test\/app\/tickets\/ticket-1/);
  assert.match(body.html, /fixxflow-logo-horizontal.png/);
  assert.match(body.html, /View update/);
  assert.match(body.html, /font-family:Inter,ui-sans-serif,system-ui/);
});
test('HTML notification titles are escaped and plain text remains available', async () => {
  await sendNotificationEmail(
    { ...item, title: '<img src=x onerror=alert(1)> & update' },
    config,
    async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.match(body.html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; update/);
      assert.doesNotMatch(body.html, /<img src=x/);
      assert.match(body.text, /<img src=x/);
      return Response.json({ id: 'safe' });
    },
  );
});
test('provider failures and missing IDs are not acknowledged as sent', async () => {
  await assert.rejects(
    sendNotificationEmail(item, config, async () => new Response('private error', { status: 429 })),
    /HTTP 429/,
  );
  await assert.rejects(
    sendNotificationEmail(item, config, async () => Response.json({})),
    /no delivery ID/,
  );
  for (const id of [undefined, null, 42, '', '   '])
    await assert.rejects(
      sendNotificationEmail(item, config, async () => Response.json({ id })),
      /no delivery ID/,
    );
  await assert.rejects(
    sendNotificationEmail(item, config, async () =>
      Response.json({ request_id: 'legacy', data: [{ code: 'EM_104' }] }),
    ),
    /no delivery ID/,
  );
  await assert.rejects(
    sendNotificationEmail(item, { ...config, siteUrl: 'http://unsafe.test' }),
    /Invalid/,
  );
});
test('Resend uses bearer authentication and invalid senders never send', async () => {
  let calls = 0;
  const request = async (_url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, 'Bearer copied-key');
    return Response.json({ id: 'provider-2' });
  };
  await sendNotificationEmail(item, { ...config, apiKey: 'copied-key' }, request);
  await assert.rejects(
    sendNotificationEmail(item, { ...config, from: 'invalid' }, request),
    /Invalid notification sender/,
  );
  await assert.rejects(
    sendNotificationEmail(
      item,
      { ...config, from: 'support@example.test\r\nBcc: private@example.test' },
      request,
    ),
    /Invalid notification sender/,
  );
  assert.equal(calls, 1);
});
test('cron fails closed when secret is missing or wrong without accessing the queue', async () => {
  const before = process.env.CRON_SECRET;
  try {
    const { GET } = load('src/app/api/cron/notifications/route.ts', {
      '@/lib/supabase/admin': {
        createAdminClient() {
          throw Error('Must not access database');
        },
      },
      '@/features/notifications/email': { sendNotificationEmail },
    });
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request('https://example.test'))).status, 401);
    process.env.CRON_SECRET = 'test-secret';
    assert.equal(
      (
        await GET(
          new Request('https://example.test', { headers: { authorization: 'Bearer incorrect' } }),
        )
      ).status,
      401,
    );
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});

test('network errors, timeouts and malformed provider responses never count as accepted delivery', async () => {
  for (const failure of [
    new TypeError('fetch failed'),
    new DOMException('Request timed out', 'TimeoutError'),
  ]) {
    await assert.rejects(
      sendNotificationEmail(item, config, async (_url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        throw failure;
      }),
      (error) => error === failure,
    );
  }
  await assert.rejects(
    sendNotificationEmail(item, config, async () => new Response('not JSON', { status: 200 })),
    SyntaxError,
  );
  for (const result of [null, [], { name: 'validation_error', message: 'private details' }]) {
    await assert.rejects(
      sendNotificationEmail(item, config, async () => Response.json(result)),
      /no delivery ID/,
    );
  }
});

test('chat and fallback email links retain the configured origin', async () => {
  for (const [target, path] of [
    [{ ticket_id: null, conversation_id: 'chat/1' }, '/app/chat/chat%2F1'],
    [{ ticket_id: null, conversation_id: null }, '/app/notifications'],
  ]) {
    await sendNotificationEmail(
      { ...item, ...target },
      { ...config, siteUrl: 'https://example.test/ignored/path' },
      async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.ok(body.text.includes(`https://example.test${path}`));
        assert.ok(body.html.includes(`href="https://example.test${path}"`));
        assert.equal(body.reply_to, 'support@fixxflow.app');
        return Response.json({ id: 'accepted' });
      },
    );
  }
});

test('ambiguous failures reuse the same idempotency key and payload across queue leases', async () => {
  const attempts = [];
  const request = async (_url, options) => {
    attempts.push({ key: options.headers['Idempotency-Key'], body: options.body });
    if (attempts.length === 1) throw new TypeError('response lost after acceptance');
    return Response.json({ id: 'accepted-once' });
  };
  await assert.rejects(
    sendNotificationEmail({ ...item, lease_token: 'first' }, config, request),
    /response lost/,
  );
  assert.equal(
    await sendNotificationEmail({ ...item, lease_token: 'retry' }, config, request),
    'accepted-once',
  );
  assert.deepEqual(attempts[0], attempts[1]);
  await sendNotificationEmail({ ...item, notification_id: 'notice-2' }, config, request);
  assert.notEqual(attempts[1].key, attempts[2].key);
});

test('approved incident emails use the shared brand and deliver only the saved message with a recipient update link', async () => {
  let body;
  await sendNotificationEmail(
    {
      ...item,
      incident_bulletin_id: 'bulletin-1',
      approved_body: 'Service is returning.\n<script>Unsafe</script>',
      next_update_at: '2026-10-20T15:00:00Z',
    },
    config,
    async (url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({ id: 'approved-message' }), { status: 200 });
    },
  );
  assert.match(body.text, /Service is returning\.\n<script>Unsafe<\/script>/);
  assert.match(body.text, /Next update expected:.*UTC/);
  assert.match(body.html, /Service is returning\.<br>&lt;script&gt;Unsafe&lt;\/script&gt;/);
  assert.match(body.html, /&lt;script&gt;Unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(body.html, /<script>/);
  assert.match(body.html, /\/app\/incident-updates\/bulletin-1/);
  assert.doesNotMatch(body.html, /\/app\/tickets\/ticket-1/);
  assert.match(body.html, /#ffd700/);
  assert.match(body.html, /fixxflow-logo-horizontal\.png/);
});

test('ticket email subject and both bodies include the number and escaped ticket name', async () => {
  let body;
  await sendNotificationEmail(
    { ...item, title: 'Ticket #1004 created — Printer <offline> & scanner' },
    config,
    async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({ id: 'ticket-name-email' });
    },
  );
  assert.equal(body.subject, 'FixxFlow: Ticket #1004 created — Printer <offline> & scanner');
  assert.match(body.text, /Ticket #1004 created — Printer <offline> & scanner/);
  assert.match(body.html, /Ticket #1004 created — Printer &lt;offline&gt; &amp; scanner/);
  assert.doesNotMatch(body.html, /<offline>/);
});

test('creation and assignment emails explain their different reasons at a glance', async () => {
  const bodies = {};
  for (const kind of ['ticket_created', 'ticket_assigned', 'ticket_reassigned', 'user_replied']) {
    await sendNotificationEmail(
      { ...item, email_kind: kind, title: 'Ticket #1006 — Printer · Priority: High' },
      config,
      async (_url, options) => {
        bodies[kind] = JSON.parse(options.body);
        return Response.json({ id: 'delivery' });
      },
    );
  }
  assert.match(bodies.ticket_created.subject, /New ticket received:/);
  assert.match(bodies.ticket_created.html, /<h1[^>]*>New ticket received<\/h1>/);
  assert.match(bodies.ticket_created.html, /Review new ticket/);
  assert.match(bodies.ticket_assigned.subject, /Assigned to you:/);
  assert.match(bodies.ticket_assigned.html, /<h1[^>]*>Assigned to you<\/h1>/);
  assert.match(bodies.ticket_assigned.html, /You are now responsible for this ticket/);
  assert.match(bodies.ticket_assigned.html, /Open assigned ticket/);
  assert.match(bodies.ticket_reassigned.text, /assignment changed/);
  assert.match(bodies.user_replied.text, /requester has added a reply/);
  for (const body of Object.values(bodies)) {
    for (const field of ['text', 'html']) assert.match(body[field], /Priority: High/);
    assert.doesNotMatch(body.html, /There is an update waiting/);
  }
});

test('public reply emails show sender, time, status, priority and escaped preview in both formats', async () => {
  const reply = {
    ...item,
    email_kind: 'ticket_response',
    reply_author: 'Alex & Team',
    reply_preview: 'Printer is ready.\n<script>alert(1)</script>',
    reply_created_at: '2026-10-24T00:00:00Z',
    ticket_status: 'in_progress',
    ticket_priority: 'high',
  };
  await sendNotificationEmail(reply, config, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.subject, /Alex & Team replied/);
    assert.match(body.html, /<h1[^>]*>Alex &amp; Team replied<\/h1>/);
    assert.match(body.html, /Reply preview/);
    assert.match(body.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(body.html, /<script>/);
    for (const format of ['html', 'text'])
      for (const value of [
        'In progress',
        'High',
        'UTC',
        'Printer is ready.',
        'Read reply and respond',
      ])
        assert.ok(body[format].includes(value), `${format}: ${value}`);
    assert.match(body.html, /Reply in FixxFlow/);
    return Response.json({ id: 'reply-preview' });
  });
});

test('status emails show the outcome and transition details instead of a generic update', async () => {
  for (const [kind, status, heading] of [
    ['ticket_resolved', 'resolved', 'Ticket resolved'],
    ['ticket_resolved', 'closed', 'Ticket closed'],
    ['ticket_reopened', 'open', 'Ticket reopened'],
  ]) {
    const statusMail = {
      ...item,
      email_kind: kind,
      ticket_status: status,
      previous_status: 'in_progress',
      status_changed_by: 'Alex Support',
      ticket_owner: 'Taylor Owner',
      ticket_priority: 'high',
      event_created_at: '2026-10-24T00:00:00Z',
    };
    await sendNotificationEmail(statusMail, config, async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(body.subject.includes(heading));
      assert.ok(body.html.includes(`>${heading}</h1>`));
      for (const field of ['html', 'text'])
        for (const value of ['In progress', 'Alex Support', 'Taylor Owner', 'High', 'UTC'])
          assert.ok(body[field].includes(value), `${field}: ${value}`);
      assert.doesNotMatch(body.html, /There is an update waiting|Reply preview/);
      return Response.json({ id: 'outcome' });
    });
  }
});

test('intake and ownership emails render a dedicated priority field in both bodies without relying on the subject', async () => {
  for (const kind of ['ticket_created', 'ticket_assigned', 'ticket_reassigned'])
    for (const [priority, label] of [
      ['low', 'Low'],
      ['normal', 'Normal'],
      ['high', 'High'],
      ['critical', 'Urgent'],
    ]) {
      await sendNotificationEmail(
        {
          ...item,
          email_kind: kind,
          title: 'Ticket #1007 — Printer issue',
          ticket_priority: priority,
        },
        config,
        async (_url, options) => {
          const body = JSON.parse(options.body);
          assert.doesNotMatch(body.subject, /Priority/);
          assert.match(body.text, new RegExp(`\\nPriority: ${label}\\n`));
          assert.match(
            body.html,
            new RegExp(`<th[^>]*scope="row"[^>]*>Priority</th><td[^>]*>${label}</td>`),
          );
          return Response.json({ id: 'intake-body-priority' });
        },
      );
    }
});

test('requester reopening email includes the recorded explanation safely in both bodies', async () => {
  await sendNotificationEmail(
    {
      ...item,
      email_kind: 'ticket_reopened',
      reopen_reason: 'Still broken <script>private</script>',
      ticket_status: 'open',
      previous_status: 'closed',
      status_changed_by: 'Taylor Employee',
      ticket_priority: 'high',
    },
    config,
    async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.match(body.subject, /Ticket reopened/);
      assert.match(body.text, /Reason for reopening:\nStill broken/);
      assert.match(body.html, /Reason for reopening/);
      assert.match(body.html, /Still broken &lt;script&gt;private&lt;\/script&gt;/);
      assert.doesNotMatch(body.html, /<script>/);
      return Response.json({ id: 'reopened' });
    },
  );
});

test('ticket emails carry the ticket number and route replies only when email to ticket is on', async () => {
  const sentBodies = [];
  const capture = async (_url, options) => {
    sentBodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: 'provider-id' }), { status: 200 });
  };
  await sendNotificationEmail(item, config, capture, {
    ticketNumber: 1042,
    replyTo: 'northwind@support.fixxflow.com',
  });
  await sendNotificationEmail(item, config, capture, { ticketNumber: 1042 });
  await sendNotificationEmail(item, config, capture);
  const [routed, numbered, plain] = sentBodies;
  assert.equal(routed.reply_to, 'northwind@support.fixxflow.com');
  assert.match(routed.subject, / \[#1042\]$/);
  assert.match(routed.text, /reply to this email to add a message to ticket #1042/i);
  assert.equal(numbered.reply_to, 'support@fixxflow.app', 'no inbound address, no email replies');
  assert.match(numbered.subject, /\[#1042\]$/);
  assert.doesNotMatch(numbered.text, /reply to this email/i);
  assert.doesNotMatch(plain.subject, /\[#/);
});

test('employee announcement emails contain the public message and home-page link without ticket routing', async () => {
  const { notificationHref } = load('src/features/notifications/presentation.ts');
  const announcement = {
    ...item,
    ticket_id: null,
    title: 'Email outage',
    service_announcement_id: 'announcement-123',
    email_kind: 'incident_update',
    approved_body:
      'We are working with the provider.\nUse chat for urgent assistance. <script>example</script>',
  };
  assert.equal(notificationHref(announcement), '/app/service-status#notice-announcement-123');
  const keys = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    await sendNotificationEmail(
      announcement,
      config,
      async (_url, options) => {
        keys.push(options.headers['Idempotency-Key']);
        const body = JSON.parse(options.body);
        assert.deepEqual(body.to, ['recipient@example.test']);
        assert.equal(body.subject, 'FixxFlow: Email outage');
        assert.match(body.text, /We are working with the provider/);
        assert.match(body.text, /View announcement:/);
        assert.match(body.html, /&lt;script&gt;example&lt;\/script&gt;/);
        assert.match(body.html, /service-status#notice-announcement-123/);
        assert.doesNotMatch(body.text, /selected stakeholder|\[#|Reply preview/);
        return Response.json({ id: 'announcement-message' });
      },
      { ticketNumber: 123, replyTo: 'internal@example.invalid' },
    );
  }
  assert.deepEqual(keys, ['notification/notice-1', 'notification/notice-1']);
});

test('announcement status and workspace are separate from escaped multiline content', async () => {
  await sendNotificationEmail(
    {
      ...item,
      ticket_id: null,
      service_announcement_id: 'notice-public',
      title: 'Email outage',
      email_kind: 'incident_update',
      approved_body: 'Status: Investigating\n\nIT is working on it.\nUse chat <safely>.',
    },
    config,
    async (_url, options) => {
      const email = JSON.parse(options.body);
      assert.match(email.html, /Example &amp; Co/);
      assert.match(email.html, /IT service update/);
      assert.match(email.html, /<strong>Status:<\/strong> Investigating<\/p>/);
      assert.match(email.html, /IT is working on it\.<br>Use chat &lt;safely&gt;\./);
      assert.doesNotMatch(email.html, /Status: Investigating<br>/);
      assert.match(email.text, /Status: Investigating\n\nIT is working on it/);
      assert.match(email.text, /https:\/\/example.test\/app\/service-status#notice-notice-public/);
      return Response.json({ id: 'public-email' });
    },
    { workspaceName: 'Example & Co' },
  );
});
