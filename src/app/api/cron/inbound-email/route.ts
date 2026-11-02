import { getInboundEmailConfiguration } from '@/features/notifications/configuration';
import { processInboundAttachments } from '@/features/tickets/inbound-attachments';
import { isCronAuthorized } from '@/lib/cron-auth';
import { reportServerError } from '@/lib/server-errors';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const config = getInboundEmailConfiguration(process.env);
  if (!config)
    return Response.json(
      { processed: 0, disabled: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  try {
    return Response.json(await processInboundAttachments(config.apiKey), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        error: 'Email attachment processing failed',
        reference: reportServerError('inbound.email', error),
      },
      { status: 500 },
    );
  }
}
