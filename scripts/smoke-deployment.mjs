import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const rawUrl = argument("url") ?? process.env.DEPLOYMENT_URL;
assert.ok(rawUrl, "Provide --url or DEPLOYMENT_URL");
const base = new URL(rawUrl);
assert.ok(base.protocol === "https:" || ["localhost", "127.0.0.1"].includes(base.hostname), "Deployment URL must use HTTPS");

const readinessToken = argument("token") ?? process.env.SMOKE_READINESS_TOKEN;
const requireReadiness = process.env.REQUIRE_READINESS === "true" || process.argv.includes("--require-ready");
if (requireReadiness) assert.ok(readinessToken, "A readiness token is required");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const timeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 10000);
const evidence = { target: base.origin, checkedAt: new Date().toISOString(), checks: [] };

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (bypass) headers.set("x-vercel-protection-bypass", bypass);
  const started = performance.now();
  const response = await fetch(new URL(path, base), { ...options, headers, redirect: "manual", signal: AbortSignal.timeout(timeout) });
  evidence.checks.push({ path, status: response.status, durationMs: Math.round(performance.now() - started) });
  return response;
}

const live = await request("/api/health/live");
assert.equal(live.status, 200, "Liveness check failed");
assert.deepEqual(await live.json(), { status: "ok" });

if (readinessToken) {
  const ready = await request("/api/health/ready", { headers: { authorization: `Bearer ${readinessToken}` } });
  assert.equal(ready.status, 200, "Readiness check failed");
  const payload = await ready.json();
  assert.equal(payload.status, "ready");
  assert.deepEqual(payload.checks, { configuration: "ok", database: "ok" });
  const expectedRelease = process.env.EXPECTED_RELEASE_SHA?.slice(0, 12);
  if (expectedRelease) assert.equal(payload.release, expectedRelease, "Deployment release does not match the requested commit");
}

for (const [path, expectedStatus] of [["/", 307], ["/login", 200]]) {
  const response = await request(path);
  assert.equal(response.status, expectedStatus, `${path} did not return its expected response`);
  if (path === "/") assert.equal(response.headers.get("location"), "/login", "/ must redirect to the local login route");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
  if (base.protocol === "https:") assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=/);
}

const output = argument("output") ?? process.env.SMOKE_EVIDENCE_PATH;
if (output) await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence));
