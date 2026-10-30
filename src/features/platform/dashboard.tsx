import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, NativeSelect } from '@/components/ui/input';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableRegion } from '@/components/ui/table';
import { rolePresentation } from '@/features/identity/role';
import { Bars } from '@/features/reporting/components';
import { ReportDownload } from '@/features/reporting/report-download';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { pageNumber } from '@/lib/pagination';
import { normalizeSearch, SEARCH_HINT, SEARCH_LIMIT } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

import { AnalyticsRetention } from './analytics-retention';
import { CustomerForm } from './customer-form';
import { eventLabels, usageTotals } from './model';
import { isPlatformData } from './payload';

export async function PlatformDashboard({
  section,
  searchParams,
}: {
  section: 'customers' | 'analytics' | 'audit';
  searchParams: Promise<{ q?: string; page?: string; days?: string }>;
}) {
  await requirePlatformOwner();
  const params = await searchParams;
  const page = pageNumber(params.page);
  const q = normalizeSearch(params.q);
  const days = [7, 30, 90].includes(Number(params.days)) ? Number(params.days) : 30;
  const db = await createClient();
  const { data, error } = await db.rpc('platform_overview', {
    search_text: q,
    page_number: page,
    days,
  });
  if (error || !isPlatformData(data)) throw Error('Platform data unavailable');
  const report = data;
  const href = (n: number) => `/platform/customers?${new URLSearchParams({ q, page: String(n) })}`;
  return (
    <div className="page stack">
      <PageHeader
        eyebrow="Platform owner"
        title={
          section === 'customers'
            ? 'Customer organizations'
            : section === 'analytics'
              ? 'Product analytics'
              : 'Platform audit log'
        }
        description={
          section === 'customers'
            ? 'Manage customer workspaces. Customer tickets and messages remain private.'
            : section === 'analytics'
              ? 'Aggregate feature usage from people who opted in. Separate from customer reporting.'
              : 'Organization changes made through the owner console.'
        }
        actions={
          section === 'customers' ? (
            <>
              <p>
                {report.organizationCount} organization{report.organizationCount === 1 ? '' : 's'}{' '}
                on the platform
              </p>
              <a href="#new-customer" className={buttonVariants({ variant: 'primary' })}>
                Add organization
              </a>
            </>
          ) : undefined
        }
      />
      {section === 'customers' && (
        <>
          <LiveSearchForm
            action="/platform/customers"
            className="queue-filters"
            label="Search organizations"
            resultSummary={`${report.matchingCount} matching organizations.`}
          >
            <label className="field">
              Search organizations
              <Input
                name="q"
                type="search"
                defaultValue={q}
                maxLength={SEARCH_LIMIT}
                aria-describedby="organization-search-hint"
              />
            </label>
            <Button variant="secondary">Search</Button>
            {q && (
              <Link className="queue-clear" href="/platform/customers">
                Clear search
              </Link>
            )}
          </LiveSearchForm>
          <p className="muted" id="organization-search-hint">
            {SEARCH_HINT}
          </p>
          <p className="muted">
            {report.matchingCount} result{report.matchingCount === 1 ? '' : 's'}
          </p>
          {report.organizations.length ? (
            <div className="settings-grid">
              {report.organizations.map((o) => (
                <article key={o.id} className="settings-card">
                  <h2>{o.name}</h2>
                  <p className="muted">
                    {o.slug} · {o.members} active members
                  </p>
                  <p>Created {o.created_at.slice(0, 10)}</p>
                  <details>
                    <summary>
                      Manage<span className="sr-only"> {o.name}</span>
                    </summary>
                    <p className="muted">
                      Changes apply to {o.name} on the platform. Customer ticket data stays private.
                    </p>
                    <CustomerForm customer={o} />
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState>
              <strong>No matching organizations</strong>
              <p>Clear the search or create a customer workspace below.</p>
            </EmptyState>
          )}
          {(page > 1 || page * 25 < report.matchingCount) && (
            <nav className="notification-pagination" aria-label="Organization pages">
              {page > 1 && (
                <Link className={buttonVariants({ variant: 'secondary' })} href={href(page - 1)}>
                  Previous
                </Link>
              )}
              {page * 25 < report.matchingCount && (
                <Link className={buttonVariants({ variant: 'secondary' })} href={href(page + 1)}>
                  Next
                </Link>
              )}
            </nav>
          )}
          <section className="settings-card" aria-labelledby="organization-export-title">
            <h2 id="organization-export-title">Export organization accounts</h2>
            <p className="muted">
              {q ? `Organizations matching “${q}”` : 'All organizations'}: workspace details, member
              counts by role, and ticket, chat and asset totals. Customer tickets, messages and
              people are not included. Each export is recorded in the platform audit log.
            </p>
            <ReportDownload
              action="/platform/customers/export"
              params={q ? { q } : {}}
              label="Download export"
              pendingLabel="Preparing export…"
              hint="Up to 5,000 organizations, oldest first. Downloads use current data."
              reload={{ href: '/platform/customers', label: 'Reload customers' }}
            />
          </section>
          <section className="settings-card page-narrow" id="new-customer">
            <h2>Create a customer workspace</h2>
            <p className="muted">Fields marked * are required.</p>
            <CustomerForm />
          </section>
        </>
      )}
      {section === 'analytics' && (
        <>
          <form className="queue-filters">
            <label className="field">
              Period
              <NativeSelect name="days" defaultValue={days}>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </NativeSelect>
            </label>
            <Button variant="secondary">Apply period</Button>
          </form>
          <p className="muted">
            UTC days, including today. Counts represent actions, not unique people. Names, customer
            identifiers, message contents and search words are excluded.
          </p>
          {!report.usage.length ? (
            <EmptyState>
              <strong>No shared usage yet</strong>
              <p>
                Counts appear after people opt in under Profile and use the product. Customer
                reporting and audit logs continue independently.
              </p>
            </EmptyState>
          ) : (
            <>
              <Bars
                allRows
                title="Feature usage"
                description={`Events recorded in the last ${days} days.`}
                rows={usageTotals(report.usage)}
              />
              <TableRegion role="region" aria-label="Product usage by role" tabIndex={0}>
                <Table className="responsive-table">
                  <thead>
                    <tr>
                      <th scope="col">Event</th>
                      <th scope="col">Role</th>
                      <th scope="col">Feature</th>
                      <th scope="col">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.usage.map((r) => (
                      <tr key={`${r.event}:${r.role}:${r.surface}`}>
                        <td data-label="Event">{eventLabels[r.event] ?? r.event}</td>
                        <td data-label="Role">
                          {rolePresentation[r.role as keyof typeof rolePresentation]?.label ??
                            r.role}
                        </td>
                        <td data-label="Feature">{r.surface}</td>
                        <td data-label="Count">{Number(r.count).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableRegion>
            </>
          )}
          <AnalyticsRetention />
        </>
      )}
      {section === 'audit' && (
        <>
          <p className="muted">
            Latest 50 owner actions. Customer activity stays in each organization’s audit log.
          </p>
          {report.audit.length ? (
            <ol className="platform-audit">
              {report.audit.map((a) => (
                <li className="settings-card" key={a.id}>
                  <strong>{a.action.replaceAll('_', ' ')}</strong>
                  <p>
                    <time dateTime={a.created_at}>
                      {new Date(a.created_at).toISOString().replace('T', ' ').slice(0, 19)} UTC
                    </time>
                  </p>
                  <details>
                    <summary>Action details</summary>
                    <dl className="asset-facts">
                      <dt>Actor ID</dt>
                      <dd>{a.actor_id}</dd>
                      {Object.entries(a.details).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key.replaceAll('_', ' ')}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState>
              <strong>No owner actions recorded yet</strong>
              <p>
                Organization setup, renames, exports and analytics cleanup runs will appear here.
              </p>
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}
