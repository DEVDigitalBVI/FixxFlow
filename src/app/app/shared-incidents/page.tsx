import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, NativeSelect } from '@/components/ui/input';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableRegion } from '@/components/ui/table';
import { requireInsightAccess } from '@/features/support-viewer/access';
import { isSharedFeed } from '@/features/support-viewer/model';
import { TicketStatusBadge } from '@/features/tickets/ticket-status-badge';
import { Timestamp } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';
import { pageNumber } from '@/lib/pagination';
import { normalizeSearch, SEARCH_LIMIT } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

export default async function SharedIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; filter?: string }>;
}) {
  const viewer = await requireViewer();
  const access = await requireInsightAccess(viewer, 'sharedIncidents');
  const params = await searchParams;
  const q = normalizeSearch(params.q),
    page = pageNumber(params.page),
    filter = ['incidents', 'priority'].includes(params.filter ?? '') ? params.filter! : 'all';
  const db = await createClient();
  const { data, error } = await db.rpc('shared_incidents', {
    org: viewer.organizationId,
    query: q,
    page,
    filter,
  });
  if (error?.code === '42501') notFound();
  if (error || !isSharedFeed(data))
    throw new Error('Shared incidents could not load. Please try again.');
  const href = (n: number) =>
    `/app/shared-incidents?${new URLSearchParams({ q, filter, page: String(n) })}`;
  return (
    <div className="page stack">
      <PageHeader
        title="Shared incidents"
        eyebrow={viewer.organizationName}
        description="Approved updates on incidents and High/Urgent tickets, with clear resolution summaries."
        actions={
          access.dashboard ? (
            <Link
              className={buttonVariants({ variant: 'secondary' })}
              href="/app/support-dashboard"
            >
              Support dashboard
            </Link>
          ) : undefined
        }
      />
      <p>
        <Badge tone="neutral">View only</Badge>{' '}
        <span className="muted">
          Shared summaries only. Your personal requests remain in My requests.
        </span>
      </p>
      {viewer.role !== 'end_user' && (
        <p className="muted">
          Staff preview includes private drafts. Publish summaries from the ticket’s Shared incident
          summary section.
        </p>
      )}
      <LiveSearchForm
        action="/app/shared-incidents"
        className="queue-filters"
        label="Search shared incidents"
        resultSummary={`${data.count} matching summaries.`}
      >
        <label className="field">
          Search shared summaries
          <Input name="q" type="search" defaultValue={q} maxLength={SEARCH_LIMIT} />
        </label>
        <label className="field">
          Show
          <NativeSelect name="filter" defaultValue={filter}>
            <option value="all">All shared issues</option>
            <option value="incidents">Incidents</option>
            <option value="priority">High and Urgent</option>
          </NativeSelect>
        </label>
        <Button variant="secondary">Apply</Button>
        {(q || filter !== 'all') && <Link href="/app/shared-incidents">Clear filters</Link>}
      </LiveSearchForm>
      <p className="muted">
        {data.count} {data.count === 1 ? 'summary' : 'summaries'}
      </p>
      {data.rows.length ? (
        <TableRegion role="region" aria-label="Shared incident summaries" tabIndex={0}>
          <Table className="responsive-table">
            <thead>
              <tr>
                <th scope="col">Issue</th>
                <th scope="col">Status</th>
                <th scope="col">Priority</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.ticket_id}>
                  <td data-label="Issue">
                    <Link href={`/app/shared-incidents/${row.ticket_id}`}>
                      <strong>
                        #{row.ticket_number} · {row.title}
                      </strong>
                    </Link>
                    <p className="muted">
                      {row.ticket_type === 'incident' ? 'Incident' : 'Priority ticket'}
                      {!row.published ? ' · Private draft' : ''}
                    </p>
                  </td>
                  <td data-label="Status">
                    <TicketStatusBadge status={row.status} />
                  </td>
                  <td data-label="Priority">
                    <TicketStatusBadge priority={row.priority} />
                  </td>
                  <td data-label="Updated">
                    <Timestamp value={row.updated_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableRegion>
      ) : (
        <EmptyState>
          <h2>
            {q || filter !== 'all' ? 'No matching shared incidents' : 'No shared incidents yet'}
          </h2>
          <p>
            {q || filter !== 'all'
              ? 'Try another search or clear the filters.'
              : 'IT-approved summaries will appear here when published.'}
          </p>
        </EmptyState>
      )}
      {(page > 1 || page * 25 < data.count) && (
        <nav className="notification-pagination" aria-label="Shared incident pages">
          {page > 1 && (
            <Link className={buttonVariants({ variant: 'secondary' })} href={href(page - 1)}>
              Previous
            </Link>
          )}
          {page * 25 < data.count && (
            <Link className={buttonVariants({ variant: 'secondary' })} href={href(page + 1)}>
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
