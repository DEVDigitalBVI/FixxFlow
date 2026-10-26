import { randomUUID } from 'node:crypto';

import {
  getInboundEmailConfiguration,
  getNotificationEmailConfiguration,
  inboundAddress,
} from '@/features/notifications/configuration';
import {
  sendNotificationEmail,
  type NotificationEmailRouting,
} from '@/features/notifications/email';
import { isCronAuthorized } from '@/lib/cron-auth';
import { reportServerError } from '@/lib/server-errors';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const emailConfiguration = getNotificationEmailConfiguration(process.env);
  if (!emailConfiguration)
    return Response.json({ error: 'Email delivery is not configured' }, { status: 503 });
  const correlationId = randomUUID();
  try {
    const database = createAdminClient();
    const escalations = await database.rpc('enqueue_incident_escalations');
    if (escalations.error) throw escalations.error;
    const reminders = await database.rpc('enqueue_incident_update_reminders');
    if (reminders.error) throw reminders.error;
    const sla = await database.rpc('enqueue_sla_notifications');
    if (sla.error) throw sla.error;
    const batch = await database.rpc('claim_notification_emails', { batch_size: 5 });
    if (batch.error) throw batch.error;
    // Ticket number and workspace address let recipients reply by email.
    const inbound = getInboundEmailConfiguration(process.env);
    const ticketIds = [
      ...new Set((batch.data ?? []).flatMap((item) => (item.ticket_id ? [item.ticket_id] : []))),
    ];
    const routes = new Map<string, NotificationEmailRouting>();
    if (ticketIds.length) {
      const tickets = await database
        .from('tickets')
        .select('id, ticket_number, organization:organizations(slug)')
        .in('id', ticketIds);
      // Routing is optional: on failure, emails still send without reply-by-email.
      if (tickets.error) reportServerError('notification.send', tickets.error, correlationId);
      for (const ticket of tickets.data ?? [])
        routes.set(ticket.id, {
          ticketNumber: ticket.ticket_number,
          replyTo:
            inbound && ticket.organization?.slug
              ? inboundAddress(ticket.organization.slug, inbound.domain)
              : undefined,
        });
    }
    let sent = 0;
    for (const item of batch.data ?? []) {
      let providerId: string | undefined;
      let failure: string | undefined;
      try {
        providerId = await sendNotificationEmail(
          item,
          emailConfiguration,
          fetch,
          item.ticket_id ? routes.get(item.ticket_id) : undefined,
        );
      } catch (error) {
        reportServerError('notification.send', error, correlationId);
        failure = 'Email delivery failed; scheduled for retry';
      }
      const finished = await database.rpc('finish_notification_email', {
        target_id: item.notification_id,
        token: item.lease_token,
        provider_message_id: providerId,
        failure,
      });
      if (finished.error || !finished.data)
        throw finished.error ?? new Error('Queue acknowledgement failed');
      if (providerId) sent++;
    }
    return Response.json(
      { processed: batch.data?.length ?? 0, sent },
      { headers: { 'X-Correlation-ID': correlationId } },
    );
  } catch (error) {
    reportServerError('notification.dispatch', error, correlationId);
    return Response.json(
      { error: 'Notification processing failed', reference: correlationId },
      { status: 500, headers: { 'X-Correlation-ID': correlationId } },
    );
  }
}
