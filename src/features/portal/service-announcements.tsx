import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { RetryButton } from '@/components/ui/retry-button';
import { announcementStatus } from '@/features/tickets/announcement-status';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { AnnouncementRefresh } from './announcement-refresh';

export async function ServiceAnnouncements({
  full = false,
  page = 1,
}: {
  full?: boolean;
  page?: number;
}) {
  const viewer = await requireViewer(),
    db = await createClient(),
    size = full ? 20 : 3;
  const { data, error } = await db
    .from('service_announcements')
    .select('id,title,body,published_at,public_status,workaround,next_update_at')
    .eq('organization_id', viewer.organizationId)
    .is('withdrawn_at', null)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .range((page - 1) * size, page * size);
  if (error)
    return (
      <section className="service-notices" aria-label="IT announcements">
        <AnnouncementRefresh />
        <p role="alert">
          Announcements could not load. <RetryButton />
        </p>
      </section>
    );
  if (!data?.length && !full) return <AnnouncementRefresh />;
  const more = (data?.length ?? 0) > size;
  return (
    <section className="service-notices" aria-labelledby="service-announcements-heading">
      <AnnouncementRefresh />
      <h2 id="service-announcements-heading">IT announcements</h2>
      {!data?.length && <p className="muted">No active service announcements.</p>}
      <ul className="service-notices-list">
        {(data ?? []).slice(0, size).map((notice) => (
          <li id={`notice-${notice.id}`} key={notice.id} className="service-notice">
            <div className="section-heading-row service-notice-heading">
              <h3>{notice.title}</h3>
              <Badge tone={announcementStatus(notice.public_status).tone} className="ticket-badge">
                {announcementStatus(notice.public_status).label}
              </Badge>
            </div>
            <p className="service-notice-message">
              {full || notice.body.length <= 240 ? notice.body : `${notice.body.slice(0, 240)}…`}
            </p>
            {notice.workaround && (
              <p className="service-notice-message">
                <strong>What to do:</strong>{' '}
                {full || notice.workaround.length <= 240
                  ? notice.workaround
                  : `${notice.workaround.slice(0, 240)}…`}
              </p>
            )}
            <div className="service-notice-footer">
              <time dateTime={notice.published_at}>
                Updated <Timestamp value={notice.published_at} />
              </time>
              {notice.next_update_at && (
                <span>
                  Next update <Timestamp value={notice.next_update_at} />
                </span>
              )}
              {!full && (notice.body.length > 240 || notice.workaround?.length > 240) && (
                <Link href={`/app/service-status#notice-${notice.id}`}>Read full update</Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!full && more && (
        <Link className="service-notices-more" href="/app/service-status">
          View all announcements
        </Link>
      )}
      {full && (page > 1 || more) && (
        <nav aria-label="Service announcement pages" className="service-notices-pagination">
          {page > 1 && <Link href={`/app/service-status?page=${page - 1}`}>Previous</Link>}
          <span>Page {page}</span>
          {more && <Link href={`/app/service-status?page=${page + 1}`}>Next</Link>}
        </nav>
      )}
    </section>
  );
}
