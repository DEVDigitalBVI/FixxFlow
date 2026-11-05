import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { dashboard, sharedIncident } from '../../../tests/fixtures/support-viewer.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const link = { default: ({ children, ...props }) => React.createElement('a', props, children) };
function setup({
  role = 'end_user',
  access = { dashboard: true, sharedIncidents: true },
  data,
  error = null,
} = {}) {
  const calls = [];
  const mocks = {
    'next/link': link,
    'next/navigation': {
      notFound: () => {
        throw Error('not-found');
      },
      usePathname: () => '/app/shared-incidents',
    },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({
        id: 'viewer',
        role,
        organizationId: 'trusted-org',
        organizationName: 'Example workspace',
      }),
    },
    '@/features/support-viewer/access': {
      requireInsightAccess: async (_, capability) => {
        if (!access[capability]) throw Error('not-found');
        return access;
      },
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data, error };
        },
      }),
    },
    '@/features/timezones/provider': {
      Timestamp: ({ value }) => React.createElement('time', { dateTime: value }, value),
    },
    '@/components/ui/live-search-form': {
      LiveSearchForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/retry-button': {
      RetryButton: () => React.createElement('button', null, 'Try again'),
    },
  };
  return { mocks, calls };
}
test('read-only dashboard reuses the six metrics and accessible trend without staff links', async () => {
  const { mocks, calls } = setup({ data: dashboard });
  const Page = load('src/app/app/support-dashboard/page.tsx', mocks).default;
  const html = render(await Page());
  assert.deepEqual(calls, [{ name: 'support_viewer_dashboard', args: { org: 'trusted-org' } }]);
  for (const label of [
    'Created',
    'Resolved',
    'Open',
    'Overdue',
    'Avg response',
    'Avg resolution',
    'Technician workload',
    'View only',
  ])
    assert.ok(html.includes(label));
  assert.match(html, /role="img"/);
  assert.match(html, /View data for/);
  assert.match(html, /14 days/);
  assert.doesNotMatch(
    html,
    /View reports|Open ticket queue|href="\/app\/tickets|href="\/app\/reports/,
  );
  const denied = setup({ access: { dashboard: false, sharedIncidents: true } });
  await assert.rejects(
    () => load('src/app/app/support-dashboard/page.tsx', denied.mocks).default(),
    /not-found/,
  );
  assert.equal(denied.calls.length, 0);
  const failed = setup({ error: { code: '500' } });
  assert.match(
    render(await load('src/app/app/support-dashboard/page.tsx', failed.mocks).default()),
    /role="alert"/,
  );
});
test('shared queue retains scoped search/filter/page state, written badges and full detail links', async () => {
  const { mocks, calls } = setup({ data: { count: 30, rows: [sharedIncident] } });
  const Page = load('src/app/app/shared-incidents/page.tsx', mocks).default;
  const html = render(
    await Page({ searchParams: Promise.resolve({ q: 'network', page: '2', filter: 'priority' }) }),
  );
  assert.deepEqual(calls, [
    {
      name: 'shared_incidents',
      args: { org: 'trusted-org', query: 'network', page: 2, filter: 'priority' },
    },
  ]);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /scope="col"/);
  assert.match(html, /data-label="Priority"/);
  assert.match(html, /Resolved/);
  assert.match(html, /q=network&amp;filter=priority&amp;page=1/);
  assert.match(html, /\/app\/shared-incidents\/70000000/);
  assert.doesNotMatch(html, /href="\/app\/tickets\/|<textarea|Assign|Add note/);
  const empty = setup({ data: { count: 0, rows: [] } });
  assert.match(
    render(
      await load('src/app/app/shared-incidents/page.tsx', empty.mocks).default({
        searchParams: Promise.resolve({}),
      }),
    ),
    /No shared incidents yet/,
  );
});
test('summary reader exposes only the approved overview and resolution and handles withdrawal', async () => {
  const { mocks } = setup({
    data: {
      count: 1,
      rows: [
        { ...sharedIncident, title: 'Safe <title>', resolution: 'Fix <script>alert(1)</script>' },
      ],
    },
  });
  const props = { params: Promise.resolve({ ticketId: sharedIncident.ticket_id }) };
  const html = render(
    await load('src/app/app/shared-incidents/[ticketId]/page.tsx', mocks).default(props),
  );
  assert.match(html, /Safe &lt;title&gt;/);
  assert.match(html, /Fix &lt;script&gt;/);
  assert.match(html, /Resolution summary/);
  assert.doesNotMatch(html, /<form|<textarea|Internal note|Attachments|Reopen ticket/);
  const withdrawn = setup({ data: { count: 0, rows: [] } });
  await assert.rejects(
    () => load('src/app/app/shared-incidents/[ticketId]/page.tsx', withdrawn.mocks).default(props),
    /not-found/,
  );
});
test('server actions deny employees before accessing the database and use verified workspace IDs', async () => {
  let role = 'end_user',
    calls = [];
  const { saveInsightAccess, saveSharedIncident } = load('src/features/support-viewer/actions.ts', {
    'next/cache': { revalidatePath: () => {} },
    '@/lib/auth/viewer': { requireViewer: async () => ({ role, organizationId: 'trusted-org' }) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { error: null };
        },
      }),
    },
  });
  const form = new FormData();
  form.set('userId', sharedIncident.ticket_id);
  form.set('ticketId', sharedIncident.ticket_id);
  form.set('revision', '0');
  form.set('dashboard', 'on');
  form.set('organizationId', 'attacker-org');
  assert.ok((await saveInsightAccess(form)).error);
  assert.ok((await saveSharedIncident(form)).error);
  assert.equal(calls.length, 0);
  role = 'technician';
  assert.ok((await saveInsightAccess(form)).error);
  role = 'administrator';
  assert.ok((await saveInsightAccess(form)).success);
  assert.equal(calls[0].args.org, 'trusted-org');
  assert.equal(calls[0].args.shared_incidents, false);
});
test('permission and sharing forms use labeled native controls, explicit publication and retained drafts', async () => {
  const formMocks = {
    'next/link': link,
    './actions': { saveInsightAccess: async () => ({}), saveSharedIncident: async () => ({}) },
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children }) => React.createElement('button', { type: 'submit' }, children),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async () => ({ data: { count: 0, rows: [] }, error: null }),
      }),
    },
  };
  const { InsightPermissionForm } = load(
    'src/features/support-viewer/permission-form.tsx',
    formMocks,
  );
  const html = render(
    React.createElement(InsightPermissionForm, {
      member: { userId: 'employee', dashboard: false, sharedIncidents: false, revision: 0 },
      name: 'Alex',
    }),
  );
  assert.match(html, /<details>/);
  assert.match(html, /View support dashboard/);
  assert.match(html, /View shared incidents/);
  assert.match(html, /<label[^>]*><input[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /checked=""/);
  const { IncidentSharingPanel } = load('src/features/support-viewer/sharing-panel.tsx', formMocks);
  const sharing = render(
    await IncidentSharingPanel({
      organizationId: 'org',
      ticketId: sharedIncident.ticket_id,
      eligible: true,
    }),
  );
  assert.match(sharing, /Publish to shared incidents/);
  assert.match(sharing, /name="revision" value="0"/);
  assert.match(
    sharing,
    /<input(?=[^>]*name="title")(?=[^>]*required="")(?=[^>]*maxLength="200")[^>]*>/,
  );
  assert.match(sharing, /name="overview" required="" maxLength="4000"/);
  assert.doesNotMatch(sharing, /checked=""/);
});

test('permission rows keep each explanation with its checkbox and share one clear privacy limit', () => {
  const { InsightPermissionForm } = load('src/features/support-viewer/permission-form.tsx', {
    './actions': { saveInsightAccess: async () => ({}) },
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children }) => React.createElement('button', null, children),
    },
  });
  const html = render(
    React.createElement(InsightPermissionForm, {
      name: 'Alex',
      member: { userId: 'person', dashboard: true, sharedIncidents: false, revision: 1 },
    }),
  );
  assert.match(
    html,
    /<label class="insight-access-option">[\s\S]*?View support dashboard[\s\S]*?ticket totals[\s\S]*?<\/label>/,
  );
  assert.match(
    html,
    /<label class="insight-access-option">[\s\S]*?View shared incidents[\s\S]*?including the resolution[\s\S]*?<\/label>/,
  );
  assert.match(
    html,
    /aria-labelledby="dashboard-label-person" aria-describedby="dashboard-help-person"/,
  );
  assert.match(
    html,
    /aria-labelledby="incidents-label-person" aria-describedby="incidents-help-person"/,
  );
  assert.equal(
    (html.match(/conversations, internal notes and attachments stay private/g) ?? []).length,
    1,
  );
});
