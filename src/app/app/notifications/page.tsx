import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { LiveNotifications } from '@/features/notifications/live-notifications';
import { notificationHref, notificationLabels } from '@/features/notifications/presentation';
import { ReadButton } from '@/features/notifications/read-button';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { pageNumber } from '@/lib/pagination';
import { createClient } from '@/lib/supabase/server';

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const unread = params.view === 'unread';
  const page = pageNumber(params.page, 10000);
  const supabase = await createClient();
  let query = supabase
    .from('notifications')
    .select(
      'id,kind,title,asset_id,inventory_item_id,ticket_id,conversation_id,incident_bulletin_id,service_announcement_id,created_at,read_at',
      {
        count: 'exact',
      },
    )
    .eq('organization_id', viewer.organizationId)
    .eq('recipient_id', viewer.id);
  if (unread) query = query.is('read_at', null);
  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range((page - 1) * 30, page * 30 - 1);
  const unreadTotal = unread
    ? { count, error }
    : await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', viewer.organizationId)
        .eq('recipient_id', viewer.id)
        .is('read_at', null);
  const pageHref = (next: number) =>
    `/app/notifications?${new URLSearchParams({ view: unread ? 'unread' : 'all', page: String(next) })}`;
  return (
    <div className={`page notification-page${viewer.role === 'end_user' ? ' portal-detail' : ''}`}>
      <LiveNotifications organizationId={viewer.organizationId} userId={viewer.id} />
      <PageHeader
        title="Notifications"
        eyebrow="Your updates"
        description="Ticket and chat updates that need your attention."
        actions={
          <>
            <Link
              className={buttonVariants({ variant: 'secondary' })}
              href="/app/notifications/settings"
            >
              Email preferences
            </Link>
            {!error && !unreadTotal.error && (unreadTotal.count ?? 0) > 0 && <ReadButton all />}
          </>
        }
      />
      <nav className="queue-views" aria-label="Notification filters">
        <Link href="/app/notifications" aria-current={!unread ? 'page' : undefined}>
          All updates
        </Link>
        <Link href="/app/notifications?view=unread" aria-current={unread ? 'page' : undefined}>
          Unread
        </Link>
      </nav>
      {error ? (
        <Alert tone="error" role="alert">
          Notifications could not be loaded.{' '}
          <Link className={buttonVariants({ variant: 'secondary' })} href={pageHref(page)}>
            Try again
          </Link>
        </Alert>
      ) : !data?.length ? (
        <section className="settings-card">
          <h2>{unread ? 'You’re all caught up' : 'No notifications yet'}</h2>
          <p className="muted">
            {page > 1
              ? 'There are no updates on this page.'
              : 'Relevant ticket and chat updates will appear here.'}
          </p>
          {page > 1 && (
            <Link className={buttonVariants({ variant: 'secondary' })} href={pageHref(1)}>
              Return to latest updates
            </Link>
          )}
        </section>
      ) : (
        <ul className="notification-list">
          {data.map((item) => (
            <li
              key={item.id}
              className={`notification-item${!item.read_at ? ' notification-unread' : ''}`}
            >
              <div className="notification-copy">
                <div className="notification-meta">
                  <span>
                    {item.conversation_id && item.kind === 'user_replied'
                      ? 'Chat reply'
                      : notificationLabels[item.kind]}
                  </span>
                  <span>{item.read_at ? 'Read' : 'Unread'}</span>
                  <time dateTime={item.created_at}>
                    <Timestamp value={item.created_at} />
                  </time>
                </div>
                <Link className="notification-title" href={notificationHref(item)}>
                  {item.title}
                </Link>
              </div>
              {!item.read_at && <ReadButton id={item.id} />}
            </li>
          ))}
        </ul>
      )}
      {!error && (page > 1 || page * 30 < (count ?? 0)) && (
        <nav className="notification-pagination" aria-label="Notification pages">
          {page > 1 && (
            <Link className={buttonVariants({ variant: 'secondary' })} href={pageHref(page - 1)}>
              Newer
            </Link>
          )}
          <span>Page {page}</span>
          {page * 30 < (count ?? 0) && (
            <Link className={buttonVariants({ variant: 'secondary' })} href={pageHref(page + 1)}>
              Older
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
