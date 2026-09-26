import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function setup({ assurance, membership, claimsError = null }) {
  const calls = [];
  const results = {
    organization_memberships: membership,
    organizations: { data: { name: 'Workspace' } },
    profiles: { data: { display_name: 'Agent', avatar_path: null } },
    product_usage_preferences: { data: { enabled: true } },
  };
  const db = {
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
  return { load: compiled.exports.requireViewer, calls };
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
