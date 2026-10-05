/** Actual Next HTTP authorization/export boundaries; fixed loopback only. */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServerClient } from '@supabase/ssr';
import { local, ok, sql, literal } from './automation-stage12c-local.mjs';
const fixture = JSON.parse(readFileSync('/tmp/fixxflow-stage12c-test-session.json', 'utf8'));
const root = 'http://localhost:3100/app/administration/automations';
async function session(index, mfa = false) {
  const cookies = new Map();
  const client = createServerClient(local.API_URL, local.ANON_KEY, { cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: rows => { for (const row of rows) cookies.set(row.name, row.value); },
  } });
  const user = fixture.users[index];
  ok(await client.auth.signInWithPassword({ email: user.email, password: user.password }));
  if (mfa) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bits = [...fixture.mfa.secret.replace(/=/g, '')].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
    const key = Buffer.from(bits.match(/.{8}/g).map(v => parseInt(v, 2))), counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const mac = createHmac('sha1', key).update(counter).digest(), offset = mac.at(-1) & 15;
    ok(await client.auth.mfa.challengeAndVerify({ factorId: fixture.mfa.factorId, code: String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0') }));
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}
const rule = sql(`select id from public.automation_rules where organization_id=${literal(fixture.orgA)} and definition->>'name'='Stage12C UI note'`);
assert.match(rule, /^[0-9a-f-]{36}$/);
const report = { environment: 'Local production-mode Next + Docker GoTrue/PostgREST', checks: [] };
async function get(cookie, suffix) {
  const response = await fetch(root + suffix, { headers: { cookie }, redirect: 'manual' });
  const body = await response.text();
  return { status: response.status, location: response.headers.get('location'), body, contentType: response.headers.get('content-type') };
}
const allowed = await session(0, true);
for (const route of ['', '/new', '/import', '/operations', '/operations/history', `/${rule}`, `/${rule}/history`]) {
  const result = await get(allowed, route); assert.equal(result.status, 200); assert.doesNotMatch(result.body, /NEXT_HTTP_ERROR_FALLBACK;404/);
  report.checks.push({ role: 'administrator AAL2', route, status: result.status, result: 'PASS' });
}
const exported = await get(allowed, `/${rule}/export`); assert.equal(exported.status, 200); assert.match(exported.contentType, /application\/json/);
const pkg = JSON.parse(exported.body); assert.equal(pkg.rules.length, 1);
writeFileSync('/tmp/fixxflow-stage12c-import.json', JSON.stringify(pkg, null, 2));
report.checks.push({ role: 'administrator AAL2', route: 'export', result: 'PASS' });
for (const [index, role] of [[0, 'administrator AAL1'], [2, 'technician'], [3, 'end_user']]) {
  const cookie = await session(index);
  for (const route of ['', '/new', '/import', '/operations', '/operations/history', '/choices?resource=teams', `/${rule}`, `/${rule}/history`, `/${rule}/export`]) {
    const result = await get(cookie, route);
    if (index === 0) {
      assert.ok((result.status === 307 && result.location?.endsWith('/auth/mfa')) || result.body.includes('NEXT_REDIRECT') && result.body.includes('/auth/mfa'));
    } else assert.ok(result.status === 404 || result.body.includes('NEXT_HTTP_ERROR_FALLBACK;404'), `${role} ${route} not denied`);
    report.checks.push({ role, route, status: result.status, result: 'PASS' });
  }
}
const other = await session(1);
for (const route of [`/${rule}`, `/${rule}/history`]) {
  const result = await get(other, route);
  assert.ok(result.status === 404 || result.body.includes('NEXT_HTTP_ERROR_FALLBACK;404'));
  assert.ok(!result.body.includes('Synthetic verification note.'));
  report.checks.push({ role: 'other tenant administrator', route, status: result.status, result: 'PASS' });
}
assert.equal((await get(other, `/${rule}/export`)).status, 400);
report.checks.push({ role: 'other tenant administrator', route: 'export', result: 'PASS, denied' });
// Selected destination UUIDs supplied by a client must never reveal another tenant.
const foreignTicket = sql(`select id from public.tickets where organization_id=${literal(fixture.orgA)}limit 1`);
const choices = await get(other, `/choices?resource=tickets&selected=${foreignTicket}`);
assert.equal(choices.status, 200); assert.ok(!JSON.parse(choices.body).rows.some(row => row.id === foreignTicket));
const operations = await get(other, '/operations'); assert.equal(operations.status, 200);
assert.ok(!operations.body.includes(fixture.orgA));
report.checks.push({ role: 'other tenant administrator', route: 'selected references and Operations', result: 'PASS, no sibling data' });
writeFileSync('/tmp/fixxflow-stage12c-app-boundaries-results.json', JSON.stringify(report, null, 2));
console.log(`PASS ${report.checks.length} local Next HTTP boundary checks; export saved as a synthetic import fixture`);
