import { timingSafeEqual } from "node:crypto";

import { reportServerError } from "@/lib/server-errors";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

const headers = { "Cache-Control": "no-store, max-age=0" };

function authorized(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ status: "unavailable" }, { status: 503, headers });
  if (!authorized(request, secret)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });

  try {
    const database = createAdminClient();
    const result = await database
      .from("organizations")
      .select("id", { head: true, count: "exact" })
      .limit(1)
      .abortSignal(AbortSignal.timeout(5000));
    if (result.error) throw result.error;
    return Response.json({
      status: "ready",
      checks: { configuration: "ok", database: "ok" },
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
    }, { headers });
  } catch (error) {
    const reference = reportServerError("health.readiness", error);
    return Response.json({ status: "unavailable", reference }, { status: 503, headers: { ...headers, "X-Correlation-ID": reference } });
  }
}
