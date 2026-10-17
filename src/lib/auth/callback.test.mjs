import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';

function callback({ error = null } = {}) {
  const calls = [];
  const { GET } = load('src/app/(auth)/auth/callback/route.ts', {
    'next/server': { NextResponse: { redirect: url => Response.redirect(url) } },
    '@/lib/supabase/server': { createClient: async () => ({ auth: {
      verifyOtp: async input => { calls.push(['invite', input]); return { error }; },
      exchangeCodeForSession: async code => { calls.push(['pkce', code]); return { error }; },
    } }) },
    '@/features/product-analytics/actions': { recordCompletedLogin: async () => calls.push(['login']) },
  });
  return { calls, get: query => GET(new Request(`https://example.test/auth/callback${query}`)) };
}

test('invitation token verification establishes a session before password setup', async () => {
  const { get, calls } = callback();
  const response = await get('?token_hash=one-use-invite&type=invite&next=https://evil.test');
  assert.equal(response.headers.get('location'), 'https://example.test/auth/update-password');
  assert.deepEqual(calls, [['invite', { token_hash: 'one-use-invite', type: 'invite' }]]);
});

test('expired or consumed invitation tokens return a clean recoverable login URL', async () => {
  const { get } = callback({ error: { code: 'otp_expired' } });
  const destination = new URL((await get('?token_hash=consumed-secret&type=invite')).headers.get('location'));
  assert.equal(destination.pathname, '/login');
  assert.ok(destination.searchParams.get('error'));
  assert.equal(destination.href.includes('consumed-secret'), false);
});

test('callback rejects missing, ambiguous, and unsupported invitation tokens', async () => {
  for (const query of ['', '?type=invite', '?token_hash=x&type=recovery', '?token_hash=x&token_hash=y&type=invite']) {
    const { get, calls } = callback();
    const response = await get(query);
    assert.equal(new URL(response.headers.get('location')).pathname, '/login');
    assert.deepEqual(calls, []);
  }
});

test('PKCE recovery and normal login callbacks retain their existing destinations', async () => {
  for (const next of ['/auth/update-password', '/app']) {
    const { get, calls } = callback();
    const response = await get(`?code=pkce-code&next=${next}`);
    assert.equal(response.headers.get('location'), `https://example.test${next}`);
    assert.deepEqual(calls, next === '/app' ? [['pkce', 'pkce-code'], ['login']] : [['pkce', 'pkce-code']]);
  }
});
