import Link from 'next/link';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { PageHeader } from '@/components/ui/page-header';
import { TicketQueueContext } from '@/features/tickets/queue-context';
import { TicketStatusBadge } from '@/features/tickets/ticket-status-badge';
import { Timestamp } from '@/features/timezones/provider';
import { SEARCH_HINT, SEARCH_LIMIT } from '@/lib/search';

import type { TicketQueueViewProps } from './queue-view-props';

export function EmployeeRequestList({
  returnTo,
  usage,
  filters,
  search,
  searchSummary,
  relatedArticles,
  error,
  tickets,
  detailHref,
  page,
  hasMore,
  pagination,
}: TicketQueueViewProps) {
  return (
    <TicketQueueContext returnTo={returnTo} panel={null} allowDrawer={false}>
      <div className="portal-page employee-requests-page">
        {usage}
        <PageHeader
          title="My requests"
          description="Track your requests and replies from IT."
          actions={
            <Link
              className={buttonVariants({ variant: 'primary' })}
              href={filters.kind === 'inventory' ? '/app/inventory' : '/app/tickets/new'}
            >
              {filters.kind === 'inventory' ? 'Request equipment' : 'New request'}
            </Link>
          }
        />
        {filters.kind === 'inventory' && (
          <p className="employee-request-guidance">
            Equipment requests are orders from department inventory. Request equipment to browse
            available items; your department needs inventory access. For a broken device or other IT
            issue, <Link href="/app/tickets/new">submit an IT request</Link>.
          </p>
        )}
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
                      filters.kind === 'inventory' ? '/app/tickets?kind=inventory' : '/app/tickets'
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
}
