import assert from 'node:assert/strict';
import test from 'node:test';
import { createServerClient } from '@supabase/ssr';
import { NextRequest } from 'next/server.js';
import nextTesting from 'next/experimental/testing/server.js';
import { load } from '../../../tests/helpers/load-module.mjs';

// Next 16.3.8 still exports the matcher helper under its middleware name.
const { unstable_doesMiddlewareMatch } = nextTesting;

const environment = { url: 'https://fixture.supabase.test', publishableKey: 'fixture-publishable-key' };
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' };
const jwt = exp => [
  { alg: 'HS256', typ: 'JWT' }, { sub: user.id, aud: 'authenticated', role: 'authenticated', exp },
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).concat('fixture-signature').join('.');

function proxyWithAuth(request) {
  return load('src/proxy.ts', {
    '@/lib/env': { getSupabaseEnvironment: () => environment },
    '@supabase/ssr': { createServerClient: (url, key, options) => createServerClient(url, key, {
      ...options, global: { fetch: request },
    }) },
  });
}

test('proxy matches application and auth routes while excluding static assets', () => {
  const { config } = proxyWithAuth(() => { throw Error('Matching must not contact Auth'); });
  for (const url of ['/app', '/app/tickets', '/auth/callback', '/login', '/platform']) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), true, url);
  }
  for (const url of ['/_next/static/chunk.js', '/_next/image?url=logo.png', '/favicon.ico', '/brand/logo.png']) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), false, url);
  }
});

test('real SSR client refreshes expired cookies for the downstream request and browser response', async () => {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = jwt(now + 3600);
  const oldSession = { access_token: jwt(now - 3600), refresh_token: 'old-refresh', expires_at: now - 3600, expires_in: 3600, token_type: 'bearer', user };
  const encoded = 'base64-' + Buffer.from(JSON.stringify(oldSession)).toString('base64url');
  const name = 'sb-fixture-auth-token';
  const split = Math.floor(encoded.length / 2);
  const calls = [];
  const { proxy } = proxyWithAuth(async (url, options) => {
    const endpoint = new URL(url);
    calls.push(endpoint.pathname);
    if (endpoint.pathname === '/auth/v1/token') {
      assert.equal(endpoint.searchParams.get('grant_type'), 'refresh_token');
      assert.equal(JSON.parse(options.body).refresh_token, 'old-refresh');
      return Response.json({ access_token: accessToken, refresh_token: 'new-refresh', expires_in: 3600, token_type: 'bearer', user });
    }
    assert.equal(endpoint.pathname, '/auth/v1/user');
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${accessToken}`);
    return Response.json(user);
  });
  const request = new NextRequest('https://app.example.test/app', {
    headers: { cookie: `${name}.0=${encoded.slice(0, split)}; ${name}.1=${encoded.slice(split)}; preference=dark` },
  });
  const response = await proxy(request);
  assert.equal(response.status, 200);
  assert.equal(calls.filter(path => path === '/auth/v1/token').length, 1);
  const refreshed = response.cookies.get(name);
  assert.ok(refreshed);
  const session = JSON.parse(Buffer.from(refreshed.value.slice('base64-'.length), 'base64url').toString());
  assert.equal(session.access_token, accessToken);
  assert.equal(session.refresh_token, 'new-refresh');
  assert.equal(request.cookies.get(name).value, refreshed.value);
  assert.equal(request.cookies.get('preference').value, 'dark');
  assert.equal(response.cookies.get(`${name}.0`).maxAge, 0);
  assert.equal(response.cookies.get(`${name}.1`).maxAge, 0);
  assert.equal(refreshed.path, '/');
  assert.equal(refreshed.sameSite, 'lax');
  assert.match(response.headers.get('x-middleware-request-cookie'), /sb-fixture-auth-token=/);
});

test('an anonymous request continues without Auth requests or session cookies', async () => {
  const { proxy } = proxyWithAuth(() => { throw Error('Anonymous requests do not need a refresh'); });
  const response = await proxy(new NextRequest('https://app.example.test/login'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
});
