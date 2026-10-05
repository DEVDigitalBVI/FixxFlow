import { reportServerError } from "@/lib/server-errors";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/features/notifications/email";
import { getNotificationEmailConfiguration } from "@/features/notifications/configuration";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const emailConfiguration = getNotificationEmailConfiguration(process.env);
  if (!emailConfiguration) return Response.json({ error: "Email delivery is not configured" }, { status: 503 });
  const correlationId = randomUUID();
  try {
    const database = createAdminClient();
    const sla = await database.rpc("enqueue_sla_notifications");
    if (sla.error) throw sla.error;
    const batch = await database.rpc("claim_notification_emails", { batch_size: 5 });
    if (batch.error) throw batch.error;
    let sent = 0;
    for (const item of batch.data ?? []) {
      let providerId: string | undefined;
      let failure: string | undefined;
      try { providerId = await sendNotificationEmail(item, emailConfiguration); }
      catch (error) { reportServerError("notification.send", error, correlationId); failure = "Email delivery failed; scheduled for retry"; }
      const finished = await database.rpc("finish_notification_email", { target_id: item.notification_id, token: item.lease_token, provider_message_id: providerId, failure });
      if (finished.error || !finished.data) throw finished.error ?? new Error("Queue acknowledgement failed");
      if (providerId) sent++;
    }
    return Response.json({ processed: batch.data?.length ?? 0, sent }, { headers: { "X-Correlation-ID": correlationId } });
  } catch (error) { reportServerError("notification.dispatch", error, correlationId); return Response.json({ error: "Notification processing failed", reference: correlationId }, { status: 500, headers: { "X-Correlation-ID": correlationId } }); }
}
