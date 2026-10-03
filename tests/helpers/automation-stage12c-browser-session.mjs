/** One-use loopback session bootstrap; real GoTrue password + TOTP, no token output. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac, randomUUID, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServerClient, serializeCookieHeader } from '@supabase/ssr';
import { local, ok, service, sql } from './automation-stage12c-local.mjs';

const fixture = JSON.parse(readFileSync('/tmp/fixxflow-stage12c-test-session.json', 'utf8'));
const loadView = process.argv.includes('--load-view');
if (loadView) {
  const org = JSON.parse(readFileSync('/tmp/fixxflow-stage12c-capacity-results.json', 'utf8')).tenants[0];
  assert.match(org, /^[0-9a-f-]{36}$/);
  const email = `stage12c-observer-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url');
  const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user;
  sql(`insert into public.organization_memberships(organization_id,user_id,role)values('${org}','${user.id}','administrator')`);
  fixture.users[0] = { id: user.id, email, password };
}
const cookies = new Map();
const client = createServerClient(local.API_URL, local.ANON_KEY, { cookies: {
  getAll: () => [...cookies].map(([name, row]) => ({ name, value: row.value })),
  setAll: values => { for (const row of values) cookies.set(row.name, row); },
} });
ok(await client.auth.signInWithPassword({ email: fixture.users[0].email, password: fixture.users[0].password }));
if (loadView) {
  const factor = ok(await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Synthetic Operations observer' }));
  fixture.mfa = { factorId: factor.id, secret: factor.totp.secret };
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const bits = [...fixture.mfa.secret.replace(/=/g, '')].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
const key = Buffer.from(bits.match(/.{8}/g).map(v => parseInt(v, 2)));
const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
const mac = createHmac('sha1', key).update(counter).digest(), offset = mac.at(-1) & 15;
const code = String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
ok(await client.auth.mfa.challengeAndVerify({ factorId: fixture.mfa.factorId, code }));
assert.equal(ok(await client.auth.mfa.getAuthenticatorAssuranceLevel()).currentLevel, 'aal2');
const server = createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/start' || request.headers.host !== 'localhost:3101') {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(303, {
    'Set-Cookie': [...cookies.values()].map(row => serializeCookieHeader(row.name, row.value, { ...row.options, secure: false, sameSite: 'lax', path: '/' })),
    Location: `http://localhost:3100/app/administration/automations${loadView ? '/operations' : ''}`,
    'Cache-Control': 'no-store',
  });
  response.end(); server.close();
});
server.listen(3101, '127.0.0.1', () => console.log('One-use local browser session ready; no credentials emitted.'));
setTimeout(() => server.close(), 120000).unref();
