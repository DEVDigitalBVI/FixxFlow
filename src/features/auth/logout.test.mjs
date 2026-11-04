import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { load } from '../../../tests/helpers/load-module.mjs';

function logout({ dbFail = false, providerFail = false, token = 'session-token' } = {}) {
  const calls = [];
  const { endCurrentSession } = load('src/features/auth/logout.ts', {
    'server-only': {},
    'next/headers': {
      cookies: async () => ({
        getAll: () => [
          { name: 'sb-project-auth-token' },
          { name: 'sb-project-auth-token.1' },
          { name: 'fixxflow-theme' },
        ],
        set: (...args) => calls.push(['cookie', ...args]),
      }),
    },
    '@/lib/server-errors': { reportServerError: () => 'reference' },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name) => {
          calls.push(['rpc', name]);
          return { data: !dbFail, error: dbFail ? { code: 'offline' } : null };
        },
        auth: {
          getClaims: async () => ({ data: { claims: { sub: 'user' } } }),
          getSession: async () => ({ data: { session: token ? { access_token: token } : null } }),
          admin: {
            signOut: async (...args) => {
              calls.push(['provider', ...args]);
              return { error: providerFail ? { code: 'offline' } : null };
            },
          },
          signOut: async (args) => {
            calls.push(['signOut', args]);
            return { error: providerFail ? { code: 'offline' } : null };
          },
        },
      }),
    },
  });
  return { run: endCurrentSession, calls };
}
test('logout revokes the current session before provider sign-out and expires every auth cookie chunk', async () => {
  const h = logout();
  assert.deepEqual(await h.run(), { userId: 'user', revoked: true });
  assert.deepEqual(h.calls[0], ['rpc', 'revoke_app_session']);
  assert.deepEqual(h.calls[1], ['signOut', { scope: 'local' }]);
  assert.equal(h.calls.filter((c) => c[0] === 'cookie').length, 2);
  assert.ok(!h.calls.some((c) => c[1] === 'fixxflow-theme'));
});
test('provider and database failures still clear local credentials without claiming confirmed revocation', async () => {
  assert.equal((await logout({ providerFail: true }).run()).revoked, true);
  assert.equal((await logout({ dbFail: true }).run()).revoked, true);
  const h = logout({ dbFail: true, providerFail: true });
  assert.equal((await h.run()).revoked, false);
  assert.equal(h.calls.filter((c) => c[0] === 'cookie').length, 2);
});
test('confirmed database revocation returns with cookies cleared before deferred provider cleanup', async () => {
  for (const providerFail of [false, true]) {
    const h = logout({ providerFail });
    const tasks = [];
    assert.deepEqual(await h.run((task) => tasks.push(task)), { userId: 'user', revoked: true });
    assert.deepEqual(h.calls[0], ['rpc', 'revoke_app_session']);
    assert.equal(h.calls.filter((c) => c[0] === 'cookie').length, 2);
    assert.ok(!h.calls.some((c) => ['signOut', 'provider'].includes(c[0])));
    assert.equal(tasks.length, 1);
    await tasks[0]();
    assert.deepEqual(h.calls.at(-1), ['provider', 'session-token', 'local']);
  }
});
test('logout awaits provider fallback when database revocation is unconfirmed or token is missing', async () => {
  for (const options of [{ dbFail: true }, { token: null }]) {
    const h = logout(options);
    const tasks = [];
    assert.equal((await h.run((task) => tasks.push(task))).revoked, true);
    assert.equal(tasks.length, 0);
    assert.ok(h.calls.some((c) => c[0] === 'signOut'));
    assert.equal(h.calls.filter((c) => c[0] === 'cookie').length, 2);
  }
});
test('native logout POST rejects cross-origin attempts and returns an uncached constrained cleanup document', async () => {
  let calls = 0;
  const { POST, GET } = load('src/app/(auth)/auth/sign-out/route.ts', {
    'next/server': { after: () => {} },
    '@/features/auth/logout': {
      endCurrentSession: async () => {
        calls++;
        return { userId: 'user', revoked: true };
      },
    },
  });
  const request = (origin) =>
    new Request('https://fixxflow.com/auth/sign-out', {
      method: 'POST',
      headers: origin ? { origin } : {},
    });
  assert.equal((await POST(request('https://evil.example'))).status, 403);
  assert.equal((await POST(request())).status, 403);
  assert.equal(calls, 0);
  assert.equal((await GET()).status, 200);
  assert.equal(calls, 0);
  const result = await POST(request('https://fixxflow.com'));
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(result.headers.get('clear-site-data'), '"cache", "storage"');
  assert.match(result.headers.get('content-security-policy'), /nonce-/);
  assert.match(await result.text(), /localStorage.clear/);
});
test('cleanup broadcasts logout, removes browser storage and caches, then replaces the document', async () => {
  const { logoutDocument } = load('src/features/auth/logout-document.ts');
  const calls = [];
  const cache = {
    keys: async () => ['cache'],
    delete: async (key) => {
      calls.push(['cache', key]);
    },
  };
  const indexedDB = {
    databases: async () => [{ name: 'drafts' }],
    deleteDatabase: (name) => {
      calls.push(['idb', name]);
      const result = {};
      queueMicrotask(() => result.onsuccess?.());
      return result;
    },
  };
  const context = {
    window: {
      caches: cache,
      indexedDB,
      location: { replace: (path) => calls.push(['replace', path]) },
    },
    caches: cache,
    indexedDB,
    localStorage: { clear: () => calls.push(['local']) },
    sessionStorage: { clear: () => calls.push(['session']) },
    navigator: {
      serviceWorker: {
        getRegistrations: async () => [{ unregister: async () => calls.push(['worker']) }],
      },
    },
    BroadcastChannel: class {
      postMessage(message) {
        calls.push(['broadcast', message]);
      }
      close() {}
    },
    setTimeout: (fn) => {
      queueMicrotask(fn);
      return 0;
    },
  };
  const script = logoutDocument('user', 'nonce', true).match(
    /<script nonce="nonce">([\s\S]*)<\/script>/,
  )[1];
  await vm.runInNewContext(script, context);
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const key of ['broadcast', 'local', 'session', 'cache', 'idb', 'worker', 'replace'])
    assert.ok(
      calls.some((c) => c[0] === key),
      key,
    );
  assert.equal(calls.find((c) => c[0] === 'replace')[1], '/login');
});
