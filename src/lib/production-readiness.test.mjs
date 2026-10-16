import assert from "node:assert/strict";
import test from "node:test";

import { load } from "../../tests/helpers/load-module.mjs";

test("liveness is public, minimal and never cached", async () => {
  const { GET } = load("src/app/api/health/live/route.ts");
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("readiness fails closed when its secret is missing or invalid", async () => {
  const previous = { health: process.env.HEALTH_CHECK_SECRET, cron: process.env.CRON_SECRET };
  let databaseCalls = 0;
  const { GET } = load("src/app/api/health/ready/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => { databaseCalls++; throw new Error("must not run"); } },
    "@/lib/server-errors": { reportServerError: () => "reference" },
  });
  try {
    delete process.env.HEALTH_CHECK_SECRET;
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request("https://example.test/api/health/ready"))).status, 503);
    process.env.HEALTH_CHECK_SECRET = "readiness-secret";
    assert.equal((await GET(new Request("https://example.test/api/health/ready", { headers: { authorization: "Bearer wrong" } }))).status, 401);
    assert.equal(databaseCalls, 0);
  } finally {
    for (const [name, value] of [["HEALTH_CHECK_SECRET", previous.health], ["CRON_SECRET", previous.cron]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("readiness verifies database access without returning records", async () => {
  const previous = { secret: process.env.HEALTH_CHECK_SECRET, release: process.env.VERCEL_GIT_COMMIT_SHA };
  const calls = [];
  const query = {
    select(columns, options) { calls.push(["select", columns, options]); return this; },
    limit(value) { calls.push(["limit", value]); return this; },
    async abortSignal(signal) { calls.push(["signal", signal instanceof AbortSignal]); return { error: null }; },
  };
  const { GET } = load("src/app/api/health/ready/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: table => { calls.push(["from", table]); return query; } }) },
    "@/lib/server-errors": { reportServerError: () => "reference" },
  });
  try {
    process.env.HEALTH_CHECK_SECRET = "readiness-secret";
    process.env.VERCEL_GIT_COMMIT_SHA = "1234567890abcdef";
    const response = await GET(new Request("https://example.test/api/health/ready", { headers: { authorization: "Bearer readiness-secret" } }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ready", checks: { configuration: "ok", database: "ok" }, release: "1234567890ab" });
    assert.deepEqual(calls.slice(0, 3), [["from", "organizations"], ["select", "id", { head: true, count: "exact" }], ["limit", 1]]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const name = key === "secret" ? "HEALTH_CHECK_SECRET" : "VERCEL_GIT_COMMIT_SHA";
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("readiness failures are correlated without exposing provider details", async () => {
  const previous = process.env.HEALTH_CHECK_SECRET;
  const errors = [];
  const query = { select() { return this; }, limit() { return this; }, async abortSignal() { return { error: { message: "private database detail" } }; } };
  const { GET } = load("src/app/api/health/ready/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => query }) },
    "@/lib/server-errors": { reportServerError: (operation, error) => { errors.push([operation, error.message]); return "safe-reference"; } },
  });
  try {
    process.env.HEALTH_CHECK_SECRET = "readiness-secret";
    const response = await GET(new Request("https://example.test/api/health/ready", { headers: { authorization: "Bearer readiness-secret" } }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unavailable", reference: "safe-reference" });
    assert.equal(response.headers.get("x-correlation-id"), "safe-reference");
    assert.deepEqual(errors, [["health.readiness", "private database detail"]]);
  } finally {
    if (previous === undefined) delete process.env.HEALTH_CHECK_SECRET; else process.env.HEALTH_CHECK_SECRET = previous;
  }
});

test("readiness keeps CRON_SECRET as a rollout fallback", async () => {
  const previous = { health: process.env.HEALTH_CHECK_SECRET, cron: process.env.CRON_SECRET };
  const query = { select() { return this; }, limit() { return this; }, async abortSignal() { return { error: null }; } };
  const { GET } = load("src/app/api/health/ready/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: () => query }) },
    "@/lib/server-errors": { reportServerError: () => "reference" },
  });
  try {
    delete process.env.HEALTH_CHECK_SECRET;
    process.env.CRON_SECRET = "cron-secret";
    const response = await GET(new Request("https://example.test/api/health/ready", { headers: { authorization: "Bearer cron-secret" } }));
    assert.equal(response.status, 200);
  } finally {
    for (const [name, value] of [["HEALTH_CHECK_SECRET", previous.health], ["CRON_SECRET", previous.cron]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("uncaught request telemetry excludes error data and request URLs", () => {
  const { reportUncaughtRequestError } = load("src/lib/request-observability.ts");
  const previous = console.error;
  const entries = [];
  console.error = value => entries.push(JSON.parse(value));
  try {
    const reference = reportUncaughtRequestError(
      new Error("private ticket body and token"),
      { method: "POST", path: "/app/tickets/secret-id?token=private", headers: { cookie: "secret" } },
      { routePath: "/app/tickets/[ticketId]", routeType: "action" },
    );
    assert.match(reference, /^[0-9a-f-]{36}$/);
    assert.deepEqual(entries[0], { event: "request.failure", code: "UNEXPECTED", correlationId: reference, method: "POST", route: "/app/tickets/[ticketId]", routeType: "action" });
    assert.doesNotMatch(JSON.stringify(entries), /private|secret-id|token|cookie/);
  } finally {
    console.error = previous;
  }
});
