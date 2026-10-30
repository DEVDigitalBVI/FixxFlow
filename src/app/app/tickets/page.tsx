import Link from 'next/link';
import { Suspense } from 'react';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, NativeSelect } from '@/components/ui/input';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableRegion } from '@/components/ui/table';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { UsageEvent } from '@/features/product-analytics/usage-event';
import { BulkActions } from '@/features/tickets/bulk-actions';
import { BulkSelectAll } from '@/features/tickets/bulk-select-all';
import { ConversationRefresh } from '@/features/tickets/conversation-refresh';
import { loadTicketQueue, type TicketQueueFilters } from '@/features/tickets/data';
import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import { TicketQueueContext } from '@/features/tickets/queue-context';
import { ticketDetailHref } from '@/features/tickets/queue-navigation';
import { QUEUE_VIEW_KEYS, queueViewQuery } from '@/features/tickets/queue-views';
import { SavedQueueViews } from '@/features/tickets/saved-queue-views';
import { RelativeAge, SlaClock, SlaIndicator } from '@/features/tickets/sla-indicator';
import { TicketDetail } from '@/features/tickets/ticket-detail';
import { TicketStatusBadge } from '@/features/tickets/ticket-status-badge';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { isUuid } from '@/lib/ids';
import { SEARCH_HINT, SEARCH_LIMIT } from '@/lib/search';
import type { TicketStatus } from '@/types/database';

import { bulkUpdateTickets } from './actions';

const active: TicketStatus[] = ['new', 'open', 'in_progress', 'waiting_on_user', 'on_hold'];
const sortOptions = {
  updated: 'Recently updated',
  oldest: 'Oldest update',
  newest: 'Newest created',
  due: 'Manual due date',
  sla: 'SLA due soon',
  priority: 'Highest priority',
} as const;

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<TicketQueueFilters>;
}) {
  const viewer = await requireViewer();
  const filters = await searchParams;
  const {
    view,
    sort,
    search,
    page,
    rows,
    error,
    profiles,
    teams,
    knowledgeCount,
    tag,
    tagOptions,
    savedViews,
    savedViewsError,
  } = await loadTicketQueue(viewer, filters);
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
        {knowledgeCount ? ` (${knowledgeCount} ${knowledgeCount === 1 ? 'match' : 'matches'})` : ''}
      </Link>
    </p>
  );
  const names = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));
  const teamNames = new Map((teams ?? []).map((t) => [t.id, t.name]));
  if (viewer.role === 'end_user')
    return (
      <TicketQueueContext returnTo={returnTo} panel={null} allowDrawer={false}>
        <div className="portal-page employee-requests-page">
          {usage}
          <PageHeader
            title="My requests"
            description="Track your requests and replies from IT."
            actions={
              <Link className={buttonVariants({ variant: 'primary' })} href="/app/tickets/new">
                New request
              </Link>
            }
          />
          <section className="employee-requests-panel" aria-label="Requests">
            <div className="employee-requests-toolbar">
              <nav className="portal-request-types" aria-label="Request types">
                <Link
                  className={buttonVariants({ variant: 'quiet' })}
                  aria-current={!filters.kind ? 'page' : undefined}
                  href={search ? `/app/tickets?q=${encodeURIComponent(search)}` : '/app/tickets'}
                >
                  All requests
                </Link>
                <Link
                  className={buttonVariants({ variant: 'quiet' })}
                  aria-current={filters.kind === 'inventory' ? 'page' : undefined}
                  href={
                    search
                      ? `/app/tickets?kind=inventory&q=${encodeURIComponent(search)}`
                      : '/app/tickets?kind=inventory'
                  }
                >
                  Equipment requests
                </Link>
              </nav>
              <LiveSearchForm
                action="/app/tickets"
                className="portal-search"
                label="Search requests"
                resultSummary={searchSummary}
                idleMessage=""
              >
                {filters.kind === 'inventory' && (
                  <input type="hidden" name="kind" value="inventory" />
                )}
                <label htmlFor="ticket-search">Search requests</label>
                <div>
                  <Input
                    id="ticket-search"
                    name="q"
                    defaultValue={search}
                    type="search"
                    maxLength={SEARCH_LIMIT}
                    aria-describedby="ticket-search-hint"
                    placeholder="Search by subject or request number"
                  />
                  <Button type="submit" variant="secondary">
                    Search
                  </Button>
                  {search && (
                    <Link
                      className={buttonVariants({ variant: 'quiet' })}
                      href={
                        filters.kind === 'inventory'
                          ? '/app/tickets?kind=inventory'
                          : '/app/tickets'
                      }
                    >
                      Clear search
                    </Link>
                  )}
                </div>
              </LiveSearchForm>
              <details className="employee-request-search-help">
                <summary>Search tips</summary>
                <p id="ticket-search-hint">
                  Results update as you type. {SEARCH_HINT} Use # for an exact request number.
                </p>
              </details>
              {relatedArticles}
            </div>
            {error ? (
              <div className="employee-requests-feedback">
                <Alert tone="error" role="alert">
                  Requests could not be loaded. Try Search again or refresh the page.
                </Alert>
              </div>
            ) : tickets?.length ? (
              <ul className="portal-ticket-list">
                {tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <Link data-queue-ticket={ticket.id} href={detailHref(ticket.id)}>
                      <span className="portal-ticket-main">
                        <strong>{ticket.title}</strong>
                        {ticket.ticket_type === 'incident' && (
                          <Badge tone="info" className="ticket-badge">
                            Incident
                          </Badge>
                        )}
                        {ticket.request_kind === 'inventory' && <small>Equipment request</small>}
                        <small>
                          #{ticket.ticket_number} · Updated <Timestamp value={ticket.updated_at} />
                        </small>
                      </span>
                      <TicketStatusBadge status={ticket.status} />
                      <span aria-hidden="true">
                        <NavigationIcon name="arrowRight" className="inline-icon" size={16} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="portal-empty">
                <h2>
                  {search
                    ? 'No matching requests'
                    : filters.kind === 'inventory'
                      ? 'No equipment requests yet'
                      : 'No requests yet'}
                </h2>
                <p>
                  {search
                    ? 'Try different words or clear your search.'
                    : 'Your requests and replies from IT will appear here.'}
                </p>
              </div>
            )}
            {!error && (page > 1 || hasMore) && pagination}
          </section>
        </div>
      </TicketQueueContext>
    );
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
    { key: 'sla', label: filters.sla === 'breached' ? 'SLA breached' : null },
    { key: 'tag', label: tag ? `Tag: ${tag}` : null },
  ] as const;
  const appliedFilters = filterChips.filter((item) => item.label);
  const activeFilterCount = appliedFilters.filter((item) => item.key !== 'q').length;
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
            <span className="ticket-queue-page-count">
              {error ? 'Queue unavailable' : `${tickets?.length ?? 0} on this page`}
            </span>
          </header>

          <div className="ticket-queue-toolbar">
            <SavedQueueViews
              views={savedViews}
              currentQuery={queueViewQuery(filters)}
              error={savedViewsError}
            />
            <LiveSearchForm
              action="/app/tickets"
              className="queue-filters"
              label="Search tickets"
              resultSummary={searchSummary}
              idleMessage=""
            >
              <input type="hidden" name="view" value={view} />
              <label className="ticket-queue-search">
                Search tickets
                <Input
                  name="q"
                  defaultValue={search}
                  type="search"
                  maxLength={SEARCH_LIMIT}
                  aria-describedby="ticket-search-hint"
                  placeholder="Search by subject, person or #ticket number…"
                />
              </label>
              <Button variant="secondary" type="submit">
                Search
              </Button>
              {(appliedFilters.length > 0 || sort !== 'updated') && (
                <Link
                  href={clearHref}
                  className={buttonVariants({ variant: 'quiet', className: 'queue-clear' })}
                >
                  Clear filters
                </Link>
              )}
              <details
                className="queue-filter-options"
                open={activeFilterCount > 0 || sort !== 'updated'}
              >
                <summary>
                  Filters and sort{activeFilterCount > 0 ? ` · ${activeFilterCount} active` : ''}
                </summary>
                <div className="queue-filter-fields">
                  <label>
                    Request type
                    <NativeSelect name="kind" defaultValue={filters.kind ?? ''}>
                      <option value="">All requests</option>
                      <option value="inventory">Equipment requests</option>
                    </NativeSelect>
                  </label>
                  <label>
                    Status
                    <NativeSelect name="status" defaultValue={filters.status ?? ''}>
                      <option value="">Any status</option>
                      {Object.entries(ticketStatuses).map(([value, p]) => (
                        <option key={value} value={value}>
                          {p.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label>
                    Ticket type
                    <NativeSelect name="type" defaultValue={filters.type ?? ''}>
                      <option value="">All ticket types</option>
                      <option value="support">Non-incident tickets</option>
                      <option value="incident">Incidents</option>
                    </NativeSelect>
                  </label>
                  <label>
                    Priority
                    <NativeSelect name="priority" defaultValue={filters.priority ?? ''}>
                      <option value="">Any priority</option>
                      {Object.entries(ticketPriorities).map(([value, p]) => (
                        <option key={value} value={value}>
                          {p.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label>
                    Sort by
                    <NativeSelect name="sort" defaultValue={sort}>
                      {Object.entries(sortOptions).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <LookupSelect
                    key={filters.team ?? ''}
                    resource="teams"
                    name="team"
                    label="Team"
                    defaultValue={filters.team ?? ''}
                    emptyLabel="All teams"
                    activeOnly={false}
                    guardSave={false}
                    compact
                  />
                  <label>
                    Tag
                    <NativeSelect name="tag" defaultValue={tag ?? ''}>
                      <option value="">Any tag</option>
                      {tag && !tagOptions.includes(tag) && <option value={tag}>{tag}</option>}
                      {tagOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <label className="queue-check">
                    <Checkbox name="overdue" value="1" defaultChecked={filters.overdue === '1'} />{' '}
                    Manual date overdue
                  </label>
                  <label className="queue-check">
                    <Checkbox
                      name="sla"
                      value="breached"
                      defaultChecked={filters.sla === 'breached'}
                    />{' '}
                    SLA breached
                  </label>
                </div>
                <Button variant="secondary" className="ticket-queue-apply" type="submit">
                  Apply filters
                </Button>
              </details>
            </LiveSearchForm>
            <p id="ticket-search-hint" className="sr-only">
              {SEARCH_HINT} Search ticket titles, descriptions, messages, people, and categories.
              Use # for an exact ticket number. Filters also apply to search results.
            </p>
            {!!appliedFilters.length && (
              <ul className="ticket-queue-filter-chips" aria-label="Applied ticket filters">
                {appliedFilters.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={withoutFilter(item.key)}
                      aria-label={`Remove ${item.key === 'q' ? 'search' : item.key} filter: ${item.label}`}
                    >
                      <span>{item.label}</span>
                      <span aria-hidden="true">
                        <NavigationIcon name="close" className="inline-icon" size={16} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {relatedArticles}
          </div>
          {error ? (
            <div className="ticket-queue-feedback">
              <Alert tone="error" role="alert">
                Tickets could not be loaded.
                <Link className={buttonVariants({ variant: 'secondary' })} href={pageHref(page)}>
                  Try again
                </Link>
              </Alert>
            </div>
          ) : (
            <SlaClock initialNow={renderedAt}>
              <form id="bulk-ticket-form" action={bulkUpdateTickets}>
                {!!tickets?.length && (
                  <div className="ticket-queue-list-heading">
                    <div className="queue-selection-control">
                      <label>
                        <BulkSelectAll formId="bulk-ticket-form" /> Select page
                      </label>
                    </div>
                    <span>
                      {sortOptions[sort]}
                      <span className="ticket-queue-sla-note">
                        {' '}
                        · SLA targets count support hours
                      </span>
                    </span>
                  </div>
                )}
                <BulkActions formId="bulk-ticket-form">
                  <div className="bulk-toolbar">
                    <strong>Bulk actions</strong>
                    <label>
                      Status
                      <NativeSelect name="status" defaultValue="">
                        <option value="">Choose status</option>
                        {Object.entries(ticketStatuses).map(([value, p]) => (
                          <option key={value} value={value}>
                            {p.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                    <Button
                      variant="secondary"
                      size="small"
                      type="submit"
                      name="intent"
                      value="status"
                    >
                      Change status
                    </Button>
                    <label>
                      Priority
                      <NativeSelect name="priority" defaultValue="">
                        <option value="">Choose priority</option>
                        {Object.entries(ticketPriorities).map(([value, p]) => (
                          <option key={value} value={value}>
                            {p.label}
                          </option>
                        ))}
                      </NativeSelect>
                    </label>
                    <Button
                      variant="secondary"
                      size="small"
                      type="submit"
                      name="intent"
                      value="priority"
                    >
                      Change priority
                    </Button>
                    <LookupSelect
                      resource="technicians"
                      name="assignee"
                      label="Technician"
                      emptyLabel="Unassigned"
                    />
                    <Button
                      variant="secondary"
                      size="small"
                      type="submit"
                      name="intent"
                      value="assignee"
                    >
                      Assign
                    </Button>
                  </div>
                </BulkActions>
                {tickets?.length ? (
                  <TableRegion role="region" aria-label="Tickets" tabIndex={0}>
                    <Table className="ticket-table responsive-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            <span className="sr-only">Select</span>
                          </th>
                          <th scope="col">Ticket</th>
                          <th scope="col">Status</th>
                          <th scope="col">Priority</th>
                          <th scope="col">Assigned to</th>
                          <th scope="col">SLA</th>
                          <th scope="col">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tickets.map((ticket) => (
                          <tr key={ticket.id}>
                            <td data-label="Select">
                              <Checkbox
                                className="queue-row-check"
                                name="ticketIds"
                                value={ticket.id}
                                aria-label={`Select ticket ${ticket.ticket_number}`}
                              />
                            </td>
                            <td data-label="Ticket">
                              <Link
                                className="ticket-link"
                                data-queue-ticket={ticket.id}
                                title={ticket.title}
                                href={detailHref(ticket.id)}
                              >
                                <span className="ticket-subject-line">
                                  <strong>{ticket.title}</strong>
                                  {ticket.ticket_type === 'incident' && (
                                    <Badge tone="info" className="ticket-badge">
                                      Incident
                                    </Badge>
                                  )}
                                  {ticket.request_kind === 'inventory' && (
                                    <small>Inventory request</small>
                                  )}
                                </span>
                                <span className="ticket-row-meta">
                                  #{ticket.ticket_number} ·{' '}
                                  <span className="sr-only">Requested by </span>
                                  {names.get(ticket.requester_id) ?? 'Unknown requester'} ·{' '}
                                  {ticket.team_id
                                    ? (teamNames.get(ticket.team_id) ?? 'Team')
                                    : 'No team'}
                                </span>
                              </Link>
                            </td>
                            <td data-label="Status">
                              <TicketStatusBadge status={ticket.status} />
                            </td>
                            <td data-label="Priority">
                              <TicketStatusBadge priority={ticket.priority} />
                            </td>
                            <td data-label="Assigned to">
                              {ticket.assigned_technician_id ? (
                                (names.get(ticket.assigned_technician_id) ?? 'Unknown')
                              ) : (
                                <span className="muted">Unassigned</span>
                              )}
                            </td>
                            <td data-label="SLA">
                              <SlaIndicator ticket={ticket} compact />
                              {ticket.due_at &&
                                Date.parse(ticket.due_at) < renderedAt &&
                                active.includes(ticket.status) && (
                                  <span className="ticket-manual-overdue">Due date overdue</span>
                                )}
                            </td>
                            <td data-label="Updated" className="muted">
                              <RelativeAge value={ticket.updated_at} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableRegion>
                ) : (
                  <EmptyState className="ticket-queue-empty">
                    <span className="empty-icon" aria-hidden="true">
                      <NavigationIcon name="check" className="inline-icon" size={16} />
                    </span>
                    <h3>
                      {appliedFilters.length
                        ? 'No matching tickets'
                        : page > 1
                          ? 'No tickets on this page'
                          : 'Nothing in this queue yet'}
                    </h3>
                    <p>
                      {appliedFilters.length
                        ? 'Try a shorter search or remove a filter to broaden your results.'
                        : page > 1
                          ? 'Return to the first page to see the latest support work.'
                          : view === 'all'
                            ? 'New support work will appear here. Create a ticket to get started.'
                            : 'New support work will appear here. Check all tickets or create a ticket to get started.'}
                    </p>
                    <Link
                      href={
                        appliedFilters.length
                          ? clearHref
                          : page > 1
                            ? pageHref(1)
                            : view === 'all'
                              ? '/app/tickets/new'
                              : '/app/tickets?view=all'
                      }
                      className={buttonVariants({ variant: 'secondary' })}
                    >
                      {appliedFilters.length
                        ? 'Clear filters'
                        : page > 1
                          ? 'Back to first page'
                          : view === 'all'
                            ? 'Create a ticket'
                            : 'Show all tickets'}
                    </Link>
                  </EmptyState>
                )}
                <footer className="ticket-queue-footer">
                  <span className="muted">
                    {tickets?.length
                      ? `Showing ${(page - 1) * 50 + 1}–${(page - 1) * 50 + tickets.length}${hasMore ? ' · More tickets available' : ''}`
                      : 'No results'}
                  </span>
                  {pagination}
                </footer>
              </form>
            </SlaClock>
          )}
        </section>
      </div>
    </TicketQueueContext>
  );
}
