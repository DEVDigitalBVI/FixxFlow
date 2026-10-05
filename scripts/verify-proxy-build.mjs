import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

// Node-runtime Proxy is recorded here, not in middleware-manifest.json.
// Check build output so a misplaced source file cannot silently disable refresh.
const manifest = JSON.parse(await readFile('.next/server/functions-config-manifest.json', 'utf8'));
const proxy = manifest.functions?.['/_middleware'];
assert.equal(proxy?.runtime, 'nodejs', 'Production build must include the session-refresh proxy');
await access('.next/server/middleware.js');
assert.ok(proxy.matchers?.length, 'Production proxy must have route matchers');
const matches = pathname => proxy.matchers.some(({ regexp }) => new RegExp(regexp).test(pathname));
for (const pathname of ['/app', '/app/tickets', '/auth/callback', '/login', '/platform']) {
  assert.ok(matches(pathname), `Built proxy must match ${pathname}`);
}
for (const pathname of ['/_next/static/chunk.js', '/_next/image', '/favicon.ico', '/brand/logo.png']) {
  assert.ok(!matches(pathname), `Built proxy must exclude ${pathname}`);
}
console.log('Production session-refresh proxy and route matchers verified.');
