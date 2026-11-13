import Link from 'next/link';
import { Suspense } from 'react';

import type { bulkUpdateTickets } from '@/app/app/tickets/actions';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { ConversationRefresh } from '@/features/tickets/conversation-refresh';
import { type TicketQueueFilters } from '@/features/tickets/data';
import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import { TicketQueueContext } from '@/features/tickets/queue-context';
import { QUEUE_VIEW_KEYS, queueViewQuery } from '@/features/tickets/queue-views';
import { SavedQueueViews } from '@/features/tickets/saved-queue-views';
import { TicketDetail } from '@/features/tickets/ticket-detail';
import { isUuid } from '@/lib/ids';

import { QueueTable } from './queue-table';
import { QueueToolbar } from './queue-toolbar';
import type { TicketQueueViewProps } from './queue-view-props';

export function StaffTicketQueue(
  props: TicketQueueViewProps & { bulkUpdateTickets: typeof bulkUpdateTickets },
) {
  const {
    filters,
    view,
    search,
    tag,
    teamNames,
    returnTo,
    usage,
    viewer,
    savedViews,
    savedViewsError,
    error,
    tickets,
  } = props;
  const views = [
    { value: 'mine', label: 'My tickets', description: 'Active support work assigned to you.' },
    {
      value: 'unassigned',
      label: 'Unassigned',
      description: 'Active tickets ready for someone to pick up.',
    },
    {
      value: 'team',
      label: 'Team queue',
      description: 'Active support work routed to your workspace’s teams.',
    },
    { value: 'all', label: 'All tickets', description: 'Support work across your workspace.' },
  ];
  const currentView = views.find((item) => item.value === view)!;
  const clearHref = `/app/tickets?view=${view}`;
  const withoutFilter = (key: keyof TicketQueueFilters) => {
    const params = new URLSearchParams();
    for (const name of QUEUE_VIEW_KEYS)
      if (name !== key && filters[name]) params.set(name, filters[name]);
    return `/app/tickets?${params}`;
  };
  const filterChips = [
    {
      key: 'type',
      label:
        filters.type === 'incident'
          ? 'Incident tickets'
          : filters.type === 'support'
            ? 'Non-incident tickets'
            : null,
    },
    { key: 'kind', label: filters.kind === 'inventory' ? 'Inventory requests' : null },
    { key: 'q', label: search ? `Search: ${search}` : null },
    {
      key: 'status',
      label: Object.entries(ticketStatuses).find(([key]) => key === filters.status)?.[1].label,
    },
    {
      key: 'priority',
      label: Object.entries(ticketPriorities).find(([key]) => key === filters.priority)?.[1].label,
    },
    { key: 'team', label: filters.team ? (teamNames.get(filters.team) ?? 'Selected team') : null },
    { key: 'overdue', label: filters.overdue === '1' ? 'Manual date overdue' : null },
    { key: 'hold', label: filters.hold === 'review' ? 'Hold follow-up overdue' : null },
    { key: 'sla', label: filters.sla === 'breached' ? 'SLA breached' : null },
    { key: 'tag', label: tag ? `Tag: ${tag}` : null },
  ] as const;
  const appliedFilters = filterChips.filter((item) => item.label);
  const activeFilterCount = appliedFilters.filter((item) => item.key !== 'q').length;
  const staffProps = { ...props, clearHref, withoutFilter, appliedFilters, activeFilterCount };
  return (
    <TicketQueueContext
      selected={filters.ticket}
      returnTo={returnTo}
      panel={
        filters.ticket && isUuid(filters.ticket) ? (
          <Suspense
            fallback={
              <div className="page" role="status">
                Loading ticket…
              </div>
            }
          >
            <TicketDetail ticketId={filters.ticket} embedded />
          </Suspense>
        ) : null
      }
    >
      <div className="page ticket-queue-page">
        {usage}
        <ConversationRefresh />
        <PageHeader
          title="Ticket queue"
          eyebrow={viewer.organizationName}
          description={currentView.description}
          actions={
            <Link className={buttonVariants({ variant: 'primary' })} href="/app/tickets/new">
              New ticket
            </Link>
          }
        />
        {filters.error && (
          <Alert tone="error" className="page-alert" role="alert">
            {filters.error}
          </Alert>
        )}
        {filters.success && (
          <Alert tone="success" className="page-alert" role="status">
            {filters.success}
          </Alert>
        )}
        <section className="ticket-queue-panel" aria-labelledby="ticket-queue-heading">
          <header className="ticket-queue-heading">
            <h2 id="ticket-queue-heading" className="sr-only">
              {currentView.label}
            </h2>
            <nav className="queue-views" aria-label="Ticket views">
              {views.map((item) => (
                <Link
                  key={item.value}
                  href={`/app/tickets?view=${item.value}`}
                  aria-current={view === item.value ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <SavedQueueViews
              views={savedViews}
              currentQuery={queueViewQuery(filters)}
              error={savedViewsError}
            />
            <span className="ticket-queue-page-count">
              {error ? 'Queue unavailable' : `${tickets?.length ?? 0} on this page`}
            </span>
          </header>

          <QueueToolbar {...staffProps} />
          <QueueTable {...staffProps} />
        </section>
      </div>
    </TicketQueueContext>
  );
}
