import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

async function render({ error = false, role = 'technician', members = [] } = {}) {
  const chain = (result) =>
    new Proxy(
      {},
      { get: (_, key) => (key === 'then' ? (resolve) => resolve(result) : () => chain(result)) },
    );
  const { IncidentFollowers } = load('src/features/tickets/incident-followers.tsx', {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/auth/viewer': { requireViewer: async () => ({ role, organizationId: 'org' }) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        from: (table) =>
          chain(
            table === 'incident_stakeholder_groups'
              ? { data: { id: 'group', revision: 2 }, error: error ? {} : null }
              : { data: members, error: null },
          ),
      }),
    },
    '@/features/lookups/labels': {
      profileLabels: async () => [{ user_id: 'gm', display_name: 'General Manager' }],
    },
    './incident-follower-actions': { manageIncidentFollower() {} },
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/retry-button': {
      RetryButton: () => React.createElement('button', null, 'Retry'),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children }) => React.createElement('button', { type: 'submit' }, children),
    },
    '@/features/lookups/lookup-select': {
      LookupSelect: ({ label, resource, describedBy, required }) =>
        React.createElement(
          'label',
          null,
          label,
          React.createElement('select', {
            'data-resource': resource,
            'aria-describedby': describedBy,
            required,
          }),
        ),
    },
  });
  return renderToStaticMarkup(await IncidentFollowers({ ticketId: 'ticket' }));
}
test('incident followers identifies the employee audience, next action and disclosure boundaries', async () => {
  const html = await render({ members: [{ user_id: 'gm' }] });
  assert.match(html, /Incident followers/);
  assert.match(html, /data-resource="people"/);
  assert.match(html, /aria-describedby="incident-followers-hint"/);
  assert.match(html, /approved incident updates/);
  assert.match(html, /doesn’t change the assignee/);
  assert.match(html, /href="#communication-plan"/);
  assert.match(html, /aren’t automatically shared/);
  assert.match(html, /General Manager/);
  assert.match(html, /name="operation" value="remove"/);
  assert.match(html, /Save an existing draft again/);
});
test('unknown follower lists offer retry instead of empty or actionable membership controls', async () => {
  const html = await render({ error: true });
  assert.match(html, /role="alert"/);
  assert.match(html, /Retry/);
  assert.doesNotMatch(html, /<form|<select|No incident followers/);
  assert.equal(await render({ role: 'end_user' }), '');
  assert.match(await render(), /No incident followers added yet/);
});
test('new drafts select followers while saved drafts preserve the explicitly reviewed groups', () => {
  const props = {
    ticketId: 'ticket',
    targetId: 'draft',
    groups: [
      { id: 'followers', name: 'Incident followers', is_follower_group: true },
      { id: 'other', name: 'Other' },
    ],
  };
  const ui = componentHarness(
    'src/features/tickets/communication-forms.tsx',
    'DraftEditor',
    props,
    {
      '@/features/timezones/provider': { useTimezone: () => 'America/Tortola' },
      './deadline-field': { DeadlineField: () => null },
      './communication-actions': { manageCommunication() {} },
    },
  );
  try {
    assert.equal(ui.find((n) => n.props.value === 'followers').props.defaultChecked, true);
    assert.equal(ui.find((n) => n.props.value === 'other').props.defaultChecked, false);
    props.draft = { revision: 1, group_ids: ['other'] };
    ui.render();
    assert.equal(ui.find((n) => n.props.value === 'followers').props.defaultChecked, false);
    assert.equal(ui.find((n) => n.props.value === 'other').props.defaultChecked, true);
  } finally {
    ui.close();
  }
});

test('follower action validates staff authority, member selection, search failures and stale lists', async () => {
  const ticket = '70000000-0000-0000-0000-000000000401',
    person = '10000000-0000-0000-0000-000000000404';
  for (const mode of ['employee', 'invalid', 'lookup', 'stale', 'failure', 'add', 'remove']) {
    const calls = [],
      paths = [];
    const { manageIncidentFollower } = load('src/features/tickets/incident-follower-actions.ts', {
      '@/lib/auth/viewer': {
        requireViewer: async () => ({
          role: mode === 'employee' ? 'end_user' : 'technician',
          organizationId: 'org',
        }),
      },
      '@/lib/supabase/server': {
        createClient: async () => ({
          rpc: async (...args) => {
            calls.push(args);
            return {
              error:
                mode === 'stale'
                  ? { code: 'PT409' }
                  : mode === 'failure'
                    ? { code: '42501' }
                    : null,
            };
          },
        }),
      },
      'next/cache': { revalidatePath: (path) => paths.push(path) },
    });
    const form = new FormData();
    Object.entries({
      ticketId: ticket,
      userId: mode === 'invalid' ? 'bad' : person,
      revision: '2',
      operation: mode === 'remove' ? 'remove' : 'add',
    }).forEach(([k, v]) => form.set(k, v));
    if (mode === 'lookup') form.set('lookupLoadError', '1');
    const result = await manageIncidentFollower(form);
    if (['employee', 'invalid', 'lookup'].includes(mode)) {
      assert.ok(result.error);
      assert.equal(calls.length, 0);
    } else if (mode === 'stale') {
      assert.match(result.error, /list changed/);
      assert.equal(paths.length, 0);
    } else if (mode === 'failure') {
      assert.ok(result.error);
      assert.equal(paths.length, 0);
    } else {
      assert.ok(result.success);
      assert.equal(calls[0][1].org, 'org');
      assert.equal(calls[0][1].person, person);
      assert.deepEqual(paths, [`/app/tickets/${ticket}`]);
    }
  }
});
