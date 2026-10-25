import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { requireViewer } from '@/lib/auth/viewer';
import { isUuid } from '@/lib/ids';
import { pageNumber } from '@/lib/pagination';
import { normalizeSearch } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

import { workflowKinds } from './model';

export type CatalogParams = {
  q?: string;
  kind?: string;
  page?: string;
  view?: string;
  ticket?: string;
};
export async function WorkflowCatalog({
  admin = false,
  params,
}: {
  admin?: boolean;
  params: CatalogParams;
}) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user' || (admin && viewer.role !== 'administrator')) notFound();
  const db = await createClient(),
    q = normalizeSearch(params.q),
    page = pageNumber(params.page, 10000),
    archived = admin && params.view === 'archived',
    kind = Object.hasOwn(workflowKinds, params.kind ?? '')
      ? (params.kind as keyof typeof workflowKinds)
      : undefined;
  const ticket = isUuid(params.ticket ?? '') ? params.ticket : undefined;
  let query = db
    .from('workflow_templates')
    .select('*', { count: 'exact' })
    .eq('organization_id', viewer.organizationId)
    .eq('archived', archived);
  if (!admin) query = query.gt('latest_version', 0);
  if (kind) query = query.eq('kind', kind);
  for (const term of q.split(' ').filter(Boolean))
    query = query.ilike('name', `%${term.replace(/[\\%_]/g, '\\$&')}%`);
  const { data, count, error } = await query
    .order('name')
    .order('id')
    .range((page - 1) * 20, page * 20 - 1);
  const base = admin ? '/app/administration/workflows' : '/app/workflows';
  const href = (next: number) =>
    `${base}?${new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { kind } : {}), ...(archived ? { view: 'archived' } : {}), ...(ticket ? { ticket } : {}), page: String(next) })}`;
  return (
    <div className="page">
      <PageHeader
        title={admin ? 'Workflow templates' : 'Company procedures'}
        eyebrow={admin ? 'Support workflows' : 'Published procedures'}
        description={
          admin
            ? 'Create, review and publish reusable response procedures. Existing tickets keep their applied versions.'
            : 'Review a published procedure before applying it to a ticket.'
        }
        back={{
          href: ticket ? `/app/tickets/${ticket}` : admin ? '/app/administration' : '/app/tickets',
          label: ticket ? 'Back to ticket' : admin ? 'Back to settings' : 'Back to tickets',
        }}
        actions={
          admin ? (
            <Link className="button button-primary" href="/app/administration/workflows/new">
              Create template
            </Link>
          ) : viewer.role === 'administrator' ? (
            <Link className="button button-secondary" href="/app/administration/workflows">
              Manage templates
            </Link>
          ) : undefined
        }
      />
      {admin && (
        <nav className="queue-views" aria-label="Template availability">
          <Link href={base} aria-current={!archived ? 'page' : undefined}>
            Active templates
          </Link>
          <Link href={`${base}?view=archived`} aria-current={archived ? 'page' : undefined}>
            Archived templates
          </Link>
        </nav>
      )}
      <form className="workflow-catalog-filters" method="get">
        <label className="field">
          Search names
          <input className="input" type="search" name="q" maxLength={200} defaultValue={q} />
        </label>
        <label className="field">
          Procedure type
          <select className="input" name="kind" defaultValue={kind ?? ''}>
            <option value="">All types</option>
            {Object.entries(workflowKinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {ticket && <input type="hidden" name="ticket" value={ticket} />}{' '}
        {archived && <input type="hidden" name="view" value="archived" />}
        <button className="button button-secondary" type="submit">
          Search procedures
        </button>
      </form>
      {error ? (
        <p role="alert">
          Procedures could not load.{' '}
          <Link className="button button-secondary" href={href(page)}>
            Try again
          </Link>
        </p>
      ) : !data?.length ? (
        <section className="settings-card">
          <h2>No procedures found</h2>
          <p className="muted">
            {admin
              ? 'Create a template or adjust your filters.'
              : 'Your administrators can publish company procedures here. Try another search or return to the ticket.'}
          </p>
        </section>
      ) : (
        <ul className="response-checklist workflow-catalog">
          {data.map((t) => (
            <li key={t.id} className="section-heading-row">
              <div>
                <h2>
                  <Link href={`${base}/${t.id}${ticket ? `?ticket=${ticket}` : ''}`}>{t.name}</Link>
                </h2>
                <p className="muted">
                  {workflowKinds[t.kind]} ·{' '}
                  {t.latest_version ? `Published version ${t.latest_version}` : 'Draft only'}
                  {t.archived ? ' · Archived' : ''}
                </p>
                <p className="ticket-description">{t.description}</p>
              </div>
              <Link
                className="button button-secondary"
                href={`${base}/${t.id}${ticket ? `?ticket=${ticket}` : ''}`}
              >
                {admin ? 'Edit template' : ticket ? 'Review and apply' : 'Review procedure'}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!error && (page > 1 || page * 20 < (count ?? 0)) && (
        <nav className="section-heading-row" aria-label="Procedure pages">
          {page > 1 && (
            <Link className="button button-secondary" href={href(page - 1)}>
              Previous page
            </Link>
          )}
          <span>Page {page}</span>
          {page * 20 < (count ?? 0) && (
            <Link className="button button-secondary" href={href(page + 1)}>
              Next page
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
