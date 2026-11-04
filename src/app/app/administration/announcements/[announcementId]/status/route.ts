import { unstable_rethrow } from 'next/navigation';

import type { EmailAnnouncementReview } from '@/features/email-announcements/model';
import { requireWorkspaceAccess } from '@/lib/auth/viewer';
import { isUuid } from '@/lib/ids';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ announcementId: string }> },
) {
  try {
    const viewer = await requireWorkspaceAccess();
    if (viewer.role !== 'administrator')
      return Response.json({ error: 'Administrator required' }, { status: 403, headers });
    const { announcementId } = await params;
    if (!isUuid(announcementId))
      return Response.json({ error: 'Announcement not found' }, { status: 404, headers });
    const db = await createClient();
    const { data, error } = await db.rpc('read_email_announcements', {
      org: viewer.organizationId,
      target: announcementId,
    });
    if (error) throw error;
    if (!data) return Response.json({ error: 'Announcement not found' }, { status: 404, headers });
    const review = data as unknown as EmailAnnouncementReview;
    return Response.json(
      { counts: review.counts, queued: Boolean(review.campaign.queued_at) },
      { headers },
    );
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('email-announcement.status', error);
    return Response.json({ error: 'Delivery status could not load' }, { status: 503, headers });
  }
}
