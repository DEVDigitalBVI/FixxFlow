import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const config = load('src/features/auth/company-sign-in.ts');
const { parseInvitationCsv } = load('src/features/administration/bulk-invite-parser.ts');
const buffer = (text) => new TextEncoder().encode(text).buffer;

test('CSV invitations preserve quoted names, normalize email and roles, reject bad rows, duplicates and excess volume before sending', () => {
  assert.deepEqual(
    parseInvitationCsv(
      buffer(
        'Email,Name,Role\r\nJORDAN@EXAMPLE.COM,"Jordan, Smith",\r\ntech@example.com,Taylor,Technician',
      ),
      'people.csv',
    ),
    [
      { email: 'jordan@example.com', displayName: 'Jordan, Smith', role: 'end_user' },
      { email: 'tech@example.com', displayName: 'Taylor', role: 'technician' },
    ],
  );
  for (const text of [
    'Email,Name\na@example.com,First\nA@example.com,Second',
    'Email,Name,Role\na@example.com,Test,Owner',
    'Email,Wrong\na@example.com,Test',
    'Email,Name\nbad,Test',
    'Email,Name\n' +
      Array.from({ length: 101 }, (_, i) => `person${i}@example.com,Person`).join('\n'),
  ])
    assert.throws(() => parseInvitationCsv(buffer(text), 'people.csv'));
  assert.throws(() => parseInvitationCsv(new ArrayBuffer(200001), 'people.csv'));
  assert.throws(() =>
    parseInvitationCsv(buffer('Email,Name\na@example.com,Person'), 'people.xlsx'),
  );
});
test('bulk endpoint validates an entire bounded group and reuses individual invitation keys without accepting a caller organization', async () => {
  const calls = [];
  let role = 'administrator';
  const { sendInvitationBatch } = load('src/app/app/people/import/actions.ts', {
    '@/lib/auth/viewer': { requireViewer: async () => ({ role, organizationId: 'trusted' }) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        from: () => ({
          select: () => ({
            eq: (_key, org) => {
              assert.equal(org, 'trusted');
              return { in: async () => ({ data: [], error: null }) };
            },
          }),
        }),
      }),
    },
    '../actions': {
      inviteMember: async (form) => {
        calls.push(Object.fromEntries(form));
        return { success: 'Accepted' };
      },
    },
  });
  const token = randomUUID();
  const row = {
    token,
    email: 'A@EXAMPLE.COM',
    displayName: 'Alex',
    role: 'end_user',
    organizationId: 'foreign',
  };
  assert.equal(
    (await sendInvitationBatch([row, { ...row, token: randomUUID(), email: 'bad' }])).error.length >
      0,
    true,
  );
  assert.equal(calls.length, 0);
  assert.equal((await sendInvitationBatch([row])).rows[0].token, token);
  assert.equal(calls[0].submissionKey, token);
  assert.equal(calls[0].email, 'a@example.com');
  assert.ok(!Object.hasOwn(calls[0], 'organizationId'));
  role = 'technician';
  assert.ok((await sendInvitationBatch([row])).error);
  assert.equal(calls.length, 1);
});
test('company login is opt-in, callbacks use the canonical origin, and authorization redirects stay on the configured Auth endpoint', () => {
  assert.deepEqual(config.companyProviders({}), []);
  assert.deepEqual(
    config.companyProviders({ AUTH_MICROSOFT_ENABLED: 'true' }).map((p) => p.provider),
    ['azure'],
  );
  assert.equal(
    config.companyCallback({ NODE_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'http://fixxflow.com' }),
    null,
  );
  assert.equal(
    config.companyCallback({ NEXT_PUBLIC_SITE_URL: 'https://fixxflow.com/ignored?next=evil' }),
    'https://fixxflow.com/auth/callback',
  );
  assert.equal(
    config.companyAuthorizeUrl(
      'https://evil.example/auth/v1/authorize',
      'https://project.supabase.co',
    ),
    null,
  );
  assert.equal(
    config.companyAuthorizeUrl('javascript:alert(1)', 'https://project.supabase.co'),
    null,
  );
  assert.equal(
    config.companyAuthorizeUrl(
      'https://project.supabase.co/auth/v1/authorize?provider=google',
      'https://project.supabase.co',
    ),
    'https://project.supabase.co/auth/v1/authorize?provider=google',
  );
});
test('assurance gate distinguishes required enrollment, MFA challenge and unavailable policy, and never treats policy failure as optional protection', async () => {
  const { requireAssurance } = load('src/lib/auth/assurance.ts', {
    'next/navigation': {
      redirect: (path) => {
        throw Error(path);
      },
    },
  });
  const db = (policy, level = { currentLevel: 'aal1', nextLevel: 'aal1' }, error = null) => ({
    rpc: async () => ({ data: policy, error }),
    auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: level }) } },
  });
  await assert.rejects(
    requireAssurance(db([{ mfa_required: true, has_verified_factor: false }])),
    /auth\/enroll/,
  );
  await assert.rejects(
    requireAssurance(db([{ mfa_required: true, has_verified_factor: true }])),
    /auth\/mfa/,
  );
  await assert.rejects(
    requireAssurance(db(null, undefined, { code: 'offline' })),
    /verify%20workspace/,
  );
  await requireAssurance(
    db([{ mfa_required: true, has_verified_factor: true }], {
      currentLevel: 'aal2',
      nextLevel: 'aal2',
    }),
  );
});
test('required enrollment disables removal of the last factor and permits adding a verified backup', async () => {
  const factors = [{ id: 'first', status: 'verified', friendly_name: 'Primary' }];
  const h = componentHarness(
    'src/features/auth/mfa-enrollment.tsx',
    'MfaEnrollment',
    { required: true },
    {
      'next/image': { default: () => null },
      '@/lib/supabase/client': {
        createClient: () => ({
          auth: { mfa: { listFactors: async () => ({ data: { totp: factors } }) } },
        }),
      },
    },
  );
  try {
    await new Promise((resolve) => setImmediate(resolve));
    h.render();
    assert.equal(
      h.find((n) => n.type === 'button' && n.props.children === 'Remove').props.disabled,
      true,
    );
    assert.equal(
      h.find((n) => n.type === 'button' && n.props.children === 'Add authenticator').props.disabled,
      false,
    );
  } finally {
    h.close();
  }
});

test('company sign-in action requests only the needed provider scope and a fixed callback', async () => {
  const keys = ['AUTH_MICROSOFT_ENABLED', 'NEXT_PUBLIC_SITE_URL'];
  const previous = keys.map((key) => process.env[key]);
  process.env.AUTH_MICROSOFT_ENABLED = 'true';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://fixxflow.com';
  const calls = [];
  const { companySignIn } = load('src/app/(auth)/company-actions.ts', {
    'next/navigation': {
      redirect: (path) => {
        throw Error(path);
      },
    },
    '@/lib/env': { getSupabaseEnvironment: () => ({ url: 'https://project.supabase.co' }) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: {
          signInWithOAuth: async (args) => {
            calls.push(args);
            return {
              data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=azure' },
              error: null,
            };
          },
        },
      }),
    },
  });
  try {
    const f = new FormData();
    f.set('provider', 'azure');
    f.set('redirectTo', 'https://evil.example');
    await assert.rejects(companySignIn(f), /project\.supabase\.co/);
    assert.equal(calls[0].options.redirectTo, 'https://fixxflow.com/auth/callback');
    assert.equal(calls[0].options.scopes, 'email');
    assert.equal(calls[0].options.skipBrowserRedirect, true);
    f.set('provider', 'github');
    await assert.rejects(companySignIn(f), /not%20available/);
    assert.equal(calls.length, 1);
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
  }
});
