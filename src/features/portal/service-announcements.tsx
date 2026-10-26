import Link from 'next/link';

import { RetryButton } from '@/components/ui/retry-button';
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
    .select('id,title,body,published_at')
    .eq('organization_id', viewer.organizationId)
    .is('withdrawn_at', null)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .range((page - 1) * size, page * size);
  if (error)
    return (
      <section className="stack" aria-label="Known service issues">
        <AnnouncementRefresh />
        <h2>Known service issues</h2>
        <p role="alert">
          Service notices could not load. You can still contact IT. <RetryButton />
        </p>
      </section>
    );
  if (!data?.length && !full) return <AnnouncementRefresh />;
  const more = (data?.length ?? 0) > size;
  return (
    <section className="stack" aria-labelledby="service-announcements-heading">
      <AnnouncementRefresh />
      <h2 id="service-announcements-heading">Known service issues</h2>
      <p className="muted">
        IT is aware of these issues. Check the updates before opening a request. You can still
        contact IT if you need help.
      </p>
      {!data?.length && <p>No active service announcements.</p>}
      <ul className="response-checklist">
        {(data ?? []).slice(0, size).map((notice) => (
          <li id={`notice-${notice.id}`} key={notice.id} className="stack">
            <h3>{notice.title}</h3>
            <p className="ticket-description">
              {full || notice.body.length <= 240 ? notice.body : `${notice.body.slice(0, 240)}…`}
            </p>
            {!full && notice.body.length > 240 && (
              <Link href={`/app/service-status#notice-${notice.id}`}>Read full update</Link>
            )}
            <p className="muted">
              Published <Timestamp value={notice.published_at} />
            </p>
          </li>
        ))}
      </ul>
      {!full && more && <Link href="/app/service-status">View all service announcements</Link>}
      {full && (page > 1 || more) && (
        <nav aria-label="Service announcement pages" className="section-heading-row">
          {page > 1 && <Link href={`/app/service-status?page=${page - 1}`}>Previous</Link>}
          <span>Page {page}</span>
          {more && <Link href={`/app/service-status?page=${page + 1}`}>Next</Link>}
        </nav>
      )}
    </section>
  );
}
