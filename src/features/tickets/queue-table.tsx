import Link from 'next/link';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { NativeSelect } from '@/components/ui/input';
import { Table, TableRegion } from '@/components/ui/table';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { BulkActions } from '@/features/tickets/bulk-actions';
import { BulkSelectAll } from '@/features/tickets/bulk-select-all';
import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import { RelativeAge, SlaClock, SlaIndicator } from '@/features/tickets/sla-indicator';
import { TicketStatusBadge } from '@/features/tickets/ticket-status-badge';

import { active, sortOptions, type StaffQueueViewProps } from './queue-view-props';

export function QueueTable({
  error,
  pageHref,
  page,
  renderedAt,
  tickets,
  sort,
  bulkUpdateTickets,
  names,
  teamNames,
  detailHref,
  appliedFilters,
  clearHref,
  view,
  hasMore,
  pagination,
}: StaffQueueViewProps) {
  return error ? (
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
              <span className="ticket-queue-sla-note"> · SLA targets count support hours</span>
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
                  <option key={value} value={value} disabled={value === 'on_hold'}>
                    {value === 'on_hold' ? 'On hold (requires ticket review)' : p.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <Button variant="secondary" size="small" type="submit" name="intent" value="status">
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
            <Button variant="secondary" size="small" type="submit" name="intent" value="priority">
              Change priority
            </Button>
            <LookupSelect
              resource="technicians"
              name="assignee"
              label="Technician"
              emptyLabel="Unassigned"
            />
            <Button variant="secondary" size="small" type="submit" name="intent" value="assignee">
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
                          {ticket.request_kind === 'inventory' && <small>Inventory request</small>}
                        </span>
                        <span className="ticket-row-meta">
                          #{ticket.ticket_number} · <span className="sr-only">Requested by </span>
                          {names.get(ticket.requester_id) ?? 'Unknown requester'} ·{' '}
                          {ticket.team_id ? (teamNames.get(ticket.team_id) ?? 'Team') : 'No team'}
                        </span>
                      </Link>
                    </td>
                    <td data-label="Status">
                      <TicketStatusBadge status={ticket.status} />
                      {ticket.status === 'on_hold' &&
                        (!ticket.hold_review_at ||
                          Date.parse(ticket.hold_review_at) <= renderedAt) && (
                          <span className="ticket-manual-overdue">Hold follow-up overdue</span>
                        )}
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
  );
}
