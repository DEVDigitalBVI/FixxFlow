import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import { load } from '../../../tests/helpers/load-module.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function setup({ assurance, membership, claimsError = null, avatarPath = null, sign = async () => ({data: {signedUrl:'signed-photo'}}) }) {
  const calls = [];
  const results = {
    organization_memberships: membership,
    organizations: { data: { name: 'Workspace' } },
    profiles: { data: { display_name: 'Agent', avatar_path: avatarPath } },
    product_usage_preferences: { data: { enabled: true } },
  };
  const db = {
    storage: { from: bucket => ({ createSignedUrl: (path, duration) => { calls.push(['sign',bucket,path,duration]); return sign(); } }) },
    auth: { getClaims: async () => ({ data: { claims: { sub: 'user', email: 'agent@example.com' } }, error: claimsError }) },
    from(table) {
      calls.push(table);
      const query = { select: () => query, eq: () => query, limit: () => query,
        maybeSingle: () => Promise.resolve(results[table]), single: () => Promise.resolve(results[table]) };
      return query;
    },
    rpc: async () => ({ data: 'none' }),
  };
  const mocks = {
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    '@/features/timezones/model': load('src/features/timezones/model.ts'),
    "@/lib/server-errors": { reportServerError: (operation) => calls.push(["failure",operation]) },
    react: { cache: fn => fn },
    'next/navigation': { redirect: path => { throw Error(path); } },
    '@/lib/auth/assurance': { requireAssurance: () => assurance },
    '@/lib/supabase/server': { createClient: async () => db },
  };
  const compiled = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/lib/auth/viewer.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => mocks[name], compiled, compiled.exports);
  return { load: compiled.exports.requireViewer, photo: compiled.exports.requireViewerAvatarUrl, calls };
}
const active = { data: { organization_id: 'org', role: 'technician', status: 'active' } };

test('membership lookup starts while assurance is pending, but viewer waits for both', async () => {
  const assurance = deferred();
  const { load, calls } = setup({ assurance: assurance.promise, membership: active });
  let finished = false;
  const result = load().then(viewer => { finished = true; return viewer; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['organization_memberships']);
  assert.equal(finished, false);
  assurance.resolve();
  const viewer = await result;
  assert.equal(viewer.organizationId, 'org');
  assert.equal(viewer.displayName, 'Agent');
  assert.equal(viewer.usageSharing, true);
});

test('viewer authorization never waits for private photo signing', async () => {
  const signing = deferred();
  const {load,photo,calls} = setup({assurance:Promise.resolve(),membership:active,avatarPath:'org/user/photo.png',sign:()=>signing.promise});
  const viewer = await load();
  assert.equal(viewer.avatarPath,'org/user/photo.png');
  assert.equal(calls.some(call=>Array.isArray(call)&&call[0]==='sign'),false);
  const pending = photo();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.at(-1),['sign','profile-photos','org/user/photo.png',3600]);
  signing.resolve({data:{signedUrl:'signed-photo'}});
  assert.equal(await pending,'signed-photo');
});

test('missing photos and storage failures use initials without weakening authorization', async () => {
  for(const options of [{}, {avatarPath:'photo',sign:async()=>({error:Error('offline')})}, {avatarPath:'photo',sign:async()=>{throw Error('offline');}}]) {
    const {photo} = setup({assurance:Promise.resolve(),membership:active,...options});
    assert.equal(await photo(),null);
  }
  const denied = setup({assurance:Promise.reject(Error('/auth/mfa')),membership:active,avatarPath:'photo'});
  await assert.rejects(denied.photo,/auth\/mfa/);
  assert.equal(denied.calls.some(call=>Array.isArray(call)&&call[0]==='sign'),false);
});

test('failed assurance never releases a viewer or loads organization data', async () => {
  const { load, calls } = setup({ assurance: Promise.reject(Error('/auth/mfa')), membership: active });
  await assert.rejects(load, /\/auth\/mfa/);
  assert.deepEqual(calls, ['organization_memberships']);
});

test('invalid claims and inactive or missing memberships still deny access', async () => {
  for (const [options, destination] of [
    [{ claimsError: Error('invalid'), membership: active }, '/login'],
    [{ membership: { data: { ...active.data, status: 'inactive' } } }, '/account/inactive'],
    [{ membership: { data: null } }, '/account/unassigned'],
  ]) {
    const { load, calls } = setup({ assurance: Promise.resolve(), ...options });
    await assert.rejects(load, error => error.message === destination);
    assert.equal(calls.includes('organizations'), false);
  }
});


test('membership failures never route an existing account into onboarding', async () => {
 const { load, calls } = setup({ assurance: Promise.resolve(), membership: { data: null, error: { code: '08006' } } });
 await assert.rejects(load, /Workspace access could not be verified/);
 assert.deepEqual(calls, ['organization_memberships', ['failure', 'viewer.membership']]);
});
