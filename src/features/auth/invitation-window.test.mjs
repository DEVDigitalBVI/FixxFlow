import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const id = '90000000-0000-4000-8000-000000000001',
  user = '10000000-0000-4000-8000-000000000001';
const tokens = load('src/features/auth/invitation-token.ts');
const secret = 'server-only-test-secret-with-sufficient-entropy';
test('invitation tokens are deterministic, domain-separated, fixed length, and persisted only as hashes', () => {
  const raw = tokens.invitationToken(id, secret);
  assert.match(raw, /^[a-f0-9]{64}$/);
  assert.equal(tokens.invitationToken(id, secret), raw);
  assert.notEqual(tokens.invitationToken(user, secret), raw);
  assert.notEqual(tokens.invitationToken(id, secret + 'rotated'), raw);
  assert.equal(tokens.invitationTokenHash(raw), createHash('sha256').update(raw).digest('hex'));
  assert.throws(() => tokens.invitationToken(id, ''));
});
test('72-hour invitation email retries retain token and provider idempotency while avoiding duplicate accepted sends', async () => {
  let sent = false,
    providerCalls = 0,
    requests = [];
  const calls = [];
  const admin = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'issue_workspace_invitation')
        return {
          data: { email: 'recipient@example.invalid', expiresAt: '2026-11-07T12:00:00Z', sent },
          error: null,
        };
      sent = true;
      return { error: null };
    },
  };
  const { sendWorkspaceInvitation } = load('src/features/auth/invitation-email.ts', {
    '@/features/notifications/template': { renderEmail: async (props) => JSON.stringify(props) },
  });
  const options = {
    admin,
    org: 'trusted-org',
    userId: user,
    actor: 'verified-admin',
    invitationId: id,
    workspaceName: 'Example workspace',
    inviterName: 'Alex',
  };
  const env = {
    RESEND_API_KEY: 'test-email-key',
    NOTIFICATIONS_FROM_EMAIL: 'FixxFlow <noreply@example.invalid>',
    NEXT_PUBLIC_SITE_URL: 'https://fixxflow.com',
    SUPABASE_SECRET_KEY: secret,
  };
  const fetcher = async (url, request) => {
    providerCalls++;
    requests.push(request);
    return { ok: true, status: 200, json: async () => ({ id: 'receipt' }) };
  };
  assert.ok((await sendWorkspaceInvitation(options, env, fetcher)).success);
  assert.ok((await sendWorkspaceInvitation(options, env, fetcher)).success);
  assert.equal(providerCalls, 1);
  assert.equal(requests[0].headers['Idempotency-Key'], `workspace-invitation/${id}`);
  const body = JSON.parse(requests[0].body);
  assert.match(body.text, /72 hours/);
  assert.match(body.text, /\/auth\/invitation\?id=/);
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(tokens.invitationToken(id, secret)));
  assert.equal(calls[0][1].org, 'trusted-org');
  assert.equal(calls[0][1].actor, 'verified-admin');
});
test('acceptance claims a link before generating a fresh invite token, verifies the same user, and prevents replay', async () => {
  const { acceptWorkspaceInvitation } = load('src/features/auth/invitation-acceptance.ts', {
    '@/lib/server-errors': { reportServerError: () => {} },
  });
  const events = [];
  let failure = false;
  const admin = {
    rpc: async (name, args) => {
      events.push([name, args]);
      return name === 'claim_workspace_invitation'
        ? { data: { email: 'recipient@example.invalid', userId: user }, error: null }
        : { error: null };
    },
    auth: {
      admin: {
        generateLink: async (args) => {
          events.push(['generate', args]);
          return {
            data: { user: { id: user }, properties: { hashed_token: 'fresh-auth-token' } },
            error: null,
          };
        },
      },
    },
  };
  const session = {
    auth: {
      verifyOtp: async (args) => {
        events.push(['verify', args]);
        return { data: { user: { id: user } }, error: failure ? { code: 'failed' } : null };
      },
    },
  };
  const raw = tokens.invitationToken(id, secret);
  assert.deepEqual(await acceptWorkspaceInvitation(id, raw, admin, session), {
    redirectTo: '/auth/update-password',
  });
  assert.deepEqual(
    events.map(([name]) => name),
    ['claim_workspace_invitation', 'generate', 'verify', 'finish_workspace_invitation'],
  );
  assert.equal(events[2][1].type, 'invite');
  assert.equal(events[3][1].success, true);
  failure = true;
  events.length = 0;
  assert.ok((await acceptWorkspaceInvitation(id, raw, admin, session)).error);
  assert.equal(events.at(-1)[1].success, false);
  events.length = 0;
  assert.ok((await acceptWorkspaceInvitation(id, 'invalid', admin, session)).error);
  assert.equal(events.length, 0);
  const unavailable = { ...admin, rpc: async () => ({ error: { code: 'PT410' }, data: null }) };
  events.length = 0;
  assert.ok((await acceptWorkspaceInvitation(id, raw, unavailable, session)).error);
  assert.equal(events.length, 0);
});
test('password-recovery GET does not verify tokens; explicit continuation uses recovery without a browser PKCE exchange', async () => {
  const verify = [];
  const mocks = {
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: {
          verifyOtp: async (args) => {
            verify.push(args);
            return { error: null };
          },
        },
      }),
    },
  };
  const { continuePasswordRecovery } = load('src/app/(auth)/auth/recovery/actions.ts', mocks);
  const bad = new FormData();
  bad.set('token_hash', 'bad');
  assert.ok((await continuePasswordRecovery(bad)).error);
  assert.equal(verify.length, 0);
  const valid = new FormData();
  valid.set('token_hash', 'a'.repeat(64));
  assert.deepEqual(await continuePasswordRecovery(valid), { redirectTo: '/auth/update-password' });
  assert.deepEqual(verify, [{ token_hash: 'a'.repeat(64), type: 'recovery' }]);
});
