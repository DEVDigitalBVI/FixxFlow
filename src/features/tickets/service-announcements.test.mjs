import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const viewer = {
  id: '10000000-0000-0000-0000-000000000401',
  organizationId: '20000000-0000-0000-0000-000000000401',
  role: 'administrator',
  timeZone: 'UTC',
};
const link = { default: ({ children, ...props }) => React.createElement('a', props, children) };
function query(data, error = null) {
  const q = {
    then(resolve) {
      return Promise.resolve({ data, error }).then(resolve);
    },
  };
  for (const name of ['select', 'eq', 'is', 'order', 'range', 'maybeSingle']) q[name] = () => q;
  return q;
}
const mocks = {
  'next/link': link,
  'next/navigation': { useRouter: () => ({ refresh() {} }) },
  '@/features/timezones/provider': {
    Timestamp: ({ value }) => React.createElement('time', null, value),
  },
  '@/lib/auth/viewer': { requireViewer: async () => viewer },
  './announcement-refresh': { AnnouncementRefresh: () => null },
};
test('employee notices render approved plain text, short summaries, safe full links, empty and recoverable errors', async () => {
  const rows = [
    {
      id: 'notice-1',
      title: '<script>email</script>',
      body: 'Safe update '.repeat(40),
      published_at: '2026-10-26T18:00Z',
      public_status: 'monitoring',
      workaround: 'Use webmail.',
      next_update_at: '2027-01-01T12:00:00Z',
    },
  ];
  for (const [data, error, full, expected] of [
    [rows, null, false, /Read full update/],
    [rows, null, true, /Safe update Safe update/],
    [[], null, true, /No active service announcements/],
    [[], { message: 'unavailable' }, false, /role="alert"/],
  ]) {
    const { ServiceAnnouncements } = load('src/features/portal/service-announcements.tsx', {
      ...mocks,
      '@/lib/supabase/server': { createClient: async () => ({ from: () => query(data, error) }) },
    });
    const html = renderToStaticMarkup(await ServiceAnnouncements({ full }));
    assert.match(html, expected);
    if (data.length) assert.match(html, /&lt;script&gt;email&lt;\/script&gt;/);
    if (data.length) {
      assert.match(html, /Monitoring/);
      assert.match(html, /Use webmail/);
      assert.match(html, /Next update/);
    }
    if (data.length) assert.match(html, /aria-labelledby="service-announcements-heading"/);
    if (!full && data.length) assert.match(html, /href="\/app\/service-status#notice-notice-1"/);
  }
});
test('home announcements keep the issue, message and timestamp in one notice without repeated guidance', async () => {
  const { ServiceAnnouncements } = load('src/features/portal/service-announcements.tsx', {
    ...mocks,
    '@/lib/supabase/server': {
      createClient: async () => ({
        from: () =>
          query([
            {
              id: 'versa',
              title: 'VERSA DOWN',
              body: 'IT is working to resolve the issue.',
              published_at: '2026-10-26T20:47:00Z',
            },
          ]),
      }),
    },
  });
  const html = renderToStaticMarkup(await ServiceAnnouncements({}));
  assert.match(html, /class="service-notices"/);
  assert.match(html, /<h3>VERSA DOWN<\/h3>/);
  assert.match(html, /class="service-notice-message"/);
  assert.match(html, /<time dateTime="2026-10-26T20:47:00Z">/);
  assert.doesNotMatch(
    html,
    /Known service issues|IT is aware of these issues|class="stack"|response-checklist/,
  );
});
test('editor has persistent labels, native constraints, safe draft and pending actions', () => {
  const { AnnouncementEditor } = load('src/features/tickets/service-announcement-forms.tsx', {
    ...mocks,
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children }) => React.createElement('button', { type: 'submit' }, children),
    },
    './service-announcement-actions': { manageServiceAnnouncement: async () => ({}) },
  });
  const html = renderToStaticMarkup(
    React.createElement(AnnouncementEditor, {
      ticketId: 'ticket',
      requestKey: '90000000-0000-0000-0000-000000000401',
      revision: 2,
      title: 'Email outage',
      body: 'IT is working on it',
    }),
  );
  assert.match(html, /<label[^>]*for=/);
  assert.match(
    html,
    /<input(?=[^>]*name="title")(?=[^>]*required="")(?=[^>]*minLength="3")(?=[^>]*maxLength="180")/,
  );
  assert.match(html, /name="body" required="" minLength="3" maxLength="3000"/);
  assert.match(html, /Publish announcement/);
  assert.match(html, /Emails all active workspace members/);
});
test('server action rejects employee access, malformed content and missing retry keys before database calls', async () => {
  const ticket = '30000000-0000-0000-0000-000000000401';
  let calls = 0;
  for (const [role, operation, confirm] of [
    ['end_user', 'save', ''],
    ['administrator', 'save', ''],
    ['administrator', 'publish', ''],
  ]) {
    const { manageServiceAnnouncement } = load(
      'src/features/tickets/service-announcement-actions.ts',
      {
        'next/cache': { revalidatePath() {} },
        '@/lib/auth/viewer': { requireViewer: async () => ({ ...viewer, role }) },
        '@/lib/supabase/server': {
          createClient: async () => {
            calls++;
            return {};
          },
        },
      },
    );
    const form = new FormData();
    for (const [key, value] of Object.entries({
      ticketId: ticket,
      operation,
      confirm,
      revision: '0',
    }))
      form.set(key, value);
    assert.ok((await manageServiceAnnouncement(form)).error);
  }
  assert.equal(calls, 0);
});

test('Coordinate shows one direct publishing form for the assignee, coordinator or administrator', async () => {
  for (const [role, assigned, owner, allowed] of [
    ['technician', viewer.id, null, true],
    ['technician', null, viewer.id, true],
    ['administrator', null, null, true],
    ['technician', null, null, false],
  ]) {
    const { ServiceAnnouncementPanel } = load(
      'src/features/tickets/service-announcement-panel.tsx',
      {
        ...mocks,
        '@/lib/auth/viewer': { requireViewer: async () => ({ ...viewer, role }) },
        '@/lib/supabase/server': {
          createClient: async () => ({
            from: (table) =>
              query(
                table === 'tickets'
                  ? { status: 'open', assigned_technician_id: assigned }
                  : table === 'ticket_workflows'
                    ? { owner_id: owner }
                    : null,
              ),
          }),
        },
        '@/components/ui/action-form': {
          ActionForm: ({ children }) => React.createElement('form', null, children),
        },
        '@/components/ui/submit-button': {
          SubmitButton: ({ children }) =>
            React.createElement('button', { type: 'submit' }, children),
        },
        './service-announcement-actions': { manageServiceAnnouncement: async () => ({}) },
      },
    );
    const html = renderToStaticMarkup(
      await ServiceAnnouncementPanel({ organizationId: viewer.organizationId, ticketId: 'ticket' }),
    );
    assert.match(html, /id="employee-announcement"/);
    assert.match(html, /<h2[^>]*>Employee announcement/);
    assert.equal(html.includes('Publish announcement'), allowed);
    assert.doesNotMatch(html, /Save announcement draft|Review saved announcement|type="checkbox"/);
  }
});
