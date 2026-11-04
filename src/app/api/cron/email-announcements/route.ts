import { dispatchEmailAnnouncements } from '@/features/email-announcements/dispatch';
import { getNotificationEmailConfiguration } from '@/features/notifications/configuration';
import { isCronAuthorized } from '@/lib/cron-auth';
import { reportServerError } from '@/lib/server-errors';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const config = getNotificationEmailConfiguration(process.env);
  if (!config) return Response.json({ error: 'Email delivery is not configured' }, { status: 503 });
  try {
    return Response.json(await dispatchEmailAnnouncements());
  } catch (error) {
    const reference = reportServerError('email-announcement.dispatch', error);
    return Response.json(
      { error: 'Email announcement processing failed', reference },
      { status: 500 },
    );
  }
}
