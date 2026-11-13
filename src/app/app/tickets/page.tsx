import Link from 'next/link';
import { Suspense } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { UsageEvent } from '@/features/product-analytics/usage-event';
import { loadTicketQueue, type TicketQueueFilters } from '@/features/tickets/data';
import { EmployeeRequestList } from '@/features/tickets/employee-request-list';
import { KnowledgeMatchCount } from '@/features/tickets/knowledge-match-count';
import { ticketDetailHref } from '@/features/tickets/queue-navigation';
import { QUEUE_VIEW_KEYS } from '@/features/tickets/queue-views';
import { StaffTicketQueue } from '@/features/tickets/staff-ticket-queue';
import { requireViewer } from '@/lib/auth/viewer';

import { bulkUpdateTickets } from './actions';

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<TicketQueueFilters>;
}) {
  const viewer = await requireViewer();
  const filters = await searchParams;
  const data = await loadTicketQueue(viewer, filters);
  const { search, page, rows, error, profiles, teams } = data;
  const pageHref = (next: number) => {
    const params = new URLSearchParams();
    for (const key of QUEUE_VIEW_KEYS) if (filters[key]) params.set(key, filters[key]);
    params.set('page', String(next));
    return `/app/tickets?${params}`;
  };
  const returnTo = pageHref(page);
  const detailHref = (id: string) => ticketDetailHref(id, returnTo);
  const tickets = rows?.slice(0, 50);
  const renderedAt = new Date().getTime();
  const searchNoun = viewer.role === 'end_user' ? 'requests' : 'tickets';
  const searchSummary = error
    ? `${viewer.role === 'end_user' ? 'Requests' : 'Tickets'} could not load. Use Search to try again.`
    : `${tickets?.length ?? 0} ${searchNoun} on this page${(rows?.length ?? 0) > 50 ? ', with more results available' : ''}.`;
  const hasMore = (rows?.length ?? 0) > 50;
  const pagination =
    page > 1 || hasMore ? (
      <nav className="notification-pagination" aria-label="Ticket pages">
        {page > 1 && (
          <Link className={buttonVariants({ variant: 'secondary' })} href={pageHref(page - 1)}>
            Previous
          </Link>
        )}
        <span>Page {page}</span>
        {hasMore && (
          <Link className={buttonVariants({ variant: 'secondary' })} href={pageHref(page + 1)}>
            Next
          </Link>
        )}
      </nav>
    ) : null;
  const usage =
    viewer.usageSharing && search && !error && page === 1 ? (
      <UsageEvent key={search} event="search_performed" surface="tickets" />
    ) : null;
  const relatedArticles = search && (
    <p className="queue-count">
      <Link href={`/app/help?q=${encodeURIComponent(search)}`}>
        Search knowledge articles
        <Suspense key={search} fallback={null}>
          <KnowledgeMatchCount organizationId={viewer.organizationId} search={search} />
        </Suspense>
      </Link>
    </p>
  );
  const names = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));
  const teamNames = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const props = {
    ...data,
    viewer,
    filters,
    returnTo,
    detailHref,
    pageHref,
    tickets,
    renderedAt,
    searchSummary,
    hasMore,
    pagination,
    usage,
    relatedArticles,
    names,
    teamNames,
  };
  return viewer.role === 'end_user' ? (
    <EmployeeRequestList {...props} />
  ) : (
    <StaffTicketQueue {...props} bulkUpdateTickets={bulkUpdateTickets} />
  );
}
