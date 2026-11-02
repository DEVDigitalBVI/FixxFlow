import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const { defaultSlaTargets, defaultSlaSchedule } = load('src/features/tickets/organization-sla.ts');
const valid = () => {
  const f = new FormData();
  f.set('version', '0');
  f.set('opens', '09:00');
  f.set('closes', '17:00');
  for (const d of [1, 2, 3, 4, 5]) f.append('days', String(d));
  for (const [p, t] of Object.entries(defaultSlaTargets))
    for (const [o, n] of Object.entries(t)) f.set(`${p}-${o}`, String(n));
  return f;
};
function action(role = 'administrator', error = null) {
  const calls = [];
  const { saveSlaPolicy } = load('src/features/administration/sla-actions.ts', {
    'next/cache': { revalidatePath: (p) => calls.push(['refresh', p]) },
    '@/lib/auth/viewer': { requireViewer: async () => ({ role, organizationId: 'viewer-org' }) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push([name, args]);
          return { data: 1, error };
        },
      }),
    },
  });
  return { save: saveSlaPolicy, calls };
}
test('SLA action scopes writes to the viewer workspace and rejects unauthorized and invalid edits', async () => {
  for (const role of ['technician', 'end_user']) {
    const a = action(role);
    assert.match((await a.save(valid())).error, /Only administrators/);
    assert.equal(a.calls.length, 0);
  }
  for (const change of [
    (f) => f.delete('days'),
    (f) => f.set('opens', '18:00'),
    (f) => f.set('high-response', '0'),
    (f) => f.set('high-response', '1.2'),
    (f) => f.set('high-response', '9999'),
    (f) => f.delete('version'),
  ]) {
    const a = action();
    const f = valid();
    change(f);
    assert.ok((await a.save(f)).error);
    assert.equal(a.calls.length, 0);
  }
  const a = action();
  const f = valid();
  f.set('organizationId', 'untrusted-org');
  assert.ok((await a.save(f)).success);
  assert.equal(a.calls[0][1].org, 'viewer-org');
  assert.deepEqual(a.calls[0][1].schedule, { days: [1, 2, 3, 4, 5], opens: 540, closes: 1020 });
  const midnight = action();
  const allDay = valid();
  allDay.set('opens', '00:00');
  allDay.set('closes', '00:00');
  assert.ok((await midnight.save(allDay)).success);
  assert.equal(midnight.calls[0][1].schedule.closes, 1440);
});
test('concurrent policy edits and network failures retain a recoverable message', async () => {
  for (const [code, pattern] of [
    ['40001', /Reload/],
    ['network', /entries are preserved/],
  ]) {
    const a = action('administrator', { code });
    assert.match((await a.save(valid())).error, pattern);
    assert.equal(a.calls.length, 1);
  }
});
test('SLA editor has grouped working days, explicitly labeled inputs and shared submit feedback', () => {
  const { SlaPolicyEditor } = load('src/features/administration/sla-policy-editor.tsx', {
    './sla-actions': { saveSlaPolicy: async () => ({ success: 'Saved' }) },
    'next/navigation': {
      useRouter: () => ({}),
      usePathname: () => '/app/administration/slas',
      useSearchParams: () => new URLSearchParams(),
    },
  });
  const html = render(
    React.createElement(SlaPolicyEditor, {
      policy: { version: 0, targets: defaultSlaTargets, schedule: defaultSlaSchedule },
      timeZone: 'America/Tortola',
    }),
  );
  assert.match(html, /aria-label="Working days"/);
  assert.equal((html.match(/name="days"/g) || []).length, 7);
  assert.equal((html.match(/type="number"/g) || []).length, 8);
  assert.match(html, /for="sla-opens"/);
  assert.match(html, /for="sla-closes"/);
  assert.match(html, /Save SLA standards/);
  assert.match(html, /Existing tickets keep their original/);
});
test('Security page provides native Back to profile navigation', async () => {
  const Page = load('src/app/app/security/page.tsx', {
    '@/lib/auth/viewer': { requireViewer: async () => ({}) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async () => ({ data: [{ mfa_required: false }], error: null }),
      }),
    },
    '@/features/auth/mfa-enrollment': { MfaEnrollment: () => null },
  }).default;
  assert.match(render(await Page()), /href="\/app\/profile"[^>]*>[\s\S]*?Back to profile/);
});

test('workspace security hides unfinished company sign-in while retaining MFA controls', async () => {
  const Page = load('src/app/app/administration/security/page.tsx', {
    'next/navigation': {
      notFound() {
        throw Error('NOT_FOUND');
      },
    },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ role: 'administrator', organizationId: 'org' }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {}, error: null }) }) }),
        }),
        rpc: async () => ({ data: [{}], error: null }),
        auth: {
          mfa: {
            getAuthenticatorAssuranceLevel: async () => ({
              data: { currentLevel: 'aal1' },
              error: null,
            }),
          },
        },
      }),
    },
    '@/features/auth/workspace-security-form': {
      WorkspaceSecurityForm: () => React.createElement('button', null, 'Save verification policy'),
    },
  }).default;
  const html = render(await Page());
  assert.match(html, /Two-step verification|Save verification policy/);
  assert.doesNotMatch(html, /Company sign-in|Microsoft Entra|Not configured/);
});

test('open SLA drafts keep their version across refreshes and advance only after their own successful save', async () => {
  const props = {
    policy: { version: 0, targets: defaultSlaTargets, schedule: defaultSlaSchedule },
    timeZone: 'UTC',
  };
  const h = componentHarness(
    'src/features/administration/sla-policy-editor.tsx',
    'SlaPolicyEditor',
    props,
    { './sla-actions': { saveSlaPolicy: async () => ({ success: 'Saved', version: 2 }) } },
  );
  try {
    props.policy = { ...props.policy, version: 1 };
    h.render();
    assert.equal(h.find((n) => n.props.name === 'version').props.value, 0);
    await h.find((n) => typeof n.props.action === 'function').props.action(valid());
    h.render();
    assert.equal(h.find((n) => n.props.name === 'version').props.value, 2);
  } finally {
    h.close();
  }
});
