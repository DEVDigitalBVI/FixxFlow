import { getInboundEmailConfiguration } from '@/features/notifications/configuration';
import {
  emailAddress,
  messageBody,
  verifyWebhookSignature,
  workspaceSlug,
} from '@/features/tickets/inbound-email';
import { reportServerError } from '@/lib/server-errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 30;
const MAX_BODY_BYTES = 1_000_000;

/**
 * Resend `email.received` webhook. Rejections (unknown sender, failed DMARC, someone
 * else's ticket) still return 200 so Resend does not retry them; transient failures
 * return 5xx so Resend retries, and the email id makes retries idempotent.
 */
export async function POST(request: Request) {
  const config = getInboundEmailConfiguration(process.env);
  if (!config) return Response.json({ error: 'Inbound email is not configured' }, { status: 503 });
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES)
    return Response.json({ error: 'Payload too large' }, { status: 413 });
  const signed = verifyWebhookSignature(
    config.webhookSecret,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    body,
  );
  if (!signed) return Response.json({ error: 'Invalid signature' }, { status: 401 });

  let event: { type?: unknown; data?: Record<string, unknown> };
  try {
    event = JSON.parse(body);
  } catch {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }
  if (event.type !== 'email.received') return Response.json({ ignored: 'event' });
  const data = event.data ?? {};
  const emailId = typeof data.email_id === 'string' ? data.email_id : null;
  if (!emailId || emailId.length > 200)
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  const recipients = [data.to, data.received_for].flatMap((list) =>
    Array.isArray(list) ? list : [],
  );
  const slug = workspaceSlug(recipients, config.domain);
  if (!slug) return Response.json({ ignored: 'recipient' });

  try {
    // The webhook carries metadata only; fetch the body and the receiving server's
    // SPF/DKIM/DMARC results, which the sender cannot forge.
    const response = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
      { headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' } },
    );
    if (!response.ok) throw new Error(`Receiving API responded ${response.status}`);
    const email = (await response.json()) as {
      from?: unknown;
      subject?: unknown;
      text?: string | null;
      html?: string | null;
      attachments?: unknown[];
      authentication?: { dmarc?: unknown } | null;
    };
    const result = await createAdminClient().rpc('accept_inbound_email', {
      provider_id: emailId,
      org_slug: slug,
      sender_email: emailAddress(email.from) ?? '',
      subject: typeof email.subject === 'string' ? email.subject.slice(0, 998) : '',
      body: messageBody(email.text, email.html),
      authenticated: email.authentication?.dmarc === 'pass',
      attachment_count: Array.isArray(email.attachments) ? email.attachments.length : 0,
    });
    if (result.error) throw result.error;
    return Response.json({
      status: (result.data as { status?: string } | null)?.status ?? 'unknown',
    });
  } catch (error) {
    const reference = reportServerError('inbound.email', error);
    return Response.json({ error: 'Inbound email processing failed', reference }, { status: 502 });
  }
}
