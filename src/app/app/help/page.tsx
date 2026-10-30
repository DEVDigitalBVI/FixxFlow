import Link from 'next/link';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { isKnowledgeAudience, knowledgeAudiences } from '@/features/knowledge/audience';
import { knowledgeCategories, knowledgeCategoryDescriptions } from '@/features/knowledge/content';
import { UsageEvent } from '@/features/product-analytics/usage-event';
import { requireViewer } from '@/lib/auth/viewer';
import { pageNumber } from '@/lib/pagination';
import { normalizeSearch, SEARCH_HINT, SEARCH_LIMIT } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    view?: string;
    audience?: string;
    page?: string;
  }>;
}) {
  const viewer = await requireViewer();
  const filters = await searchParams;
  const database = await createClient();
  const q = normalizeSearch(filters.q);
  const staff = viewer.role !== 'end_user';
  const page = pageNumber(filters.page, 10000);
  const source = q
    ? database.rpc('search_knowledge_articles', {
        target_organization_id: viewer.organizationId,
        search_text: q,
      })
    : database.from('readable_knowledge_articles');
  let query = source
    .select('id,organization_id,title,summary,category,status,audience,updated_at')
    .or(`organization_id.eq.${viewer.organizationId},organization_id.is.null`);
  if (!staff || filters.view !== 'all') query = query.eq('status', 'published');
  const audience = staff && isKnowledgeAudience(filters.audience) ? filters.audience : '';
  if (!staff) query = query.eq('audience', 'employees');
  else if (audience) query = query.eq('audience', audience);
  if (knowledgeCategories.some((c) => c === filters.category))
    query = query.eq('category', filters.category!);
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .order('id')
    .range((page - 1) * 24, page * 24);
  const pageHref = (next: number) =>
    `/app/help?${new URLSearchParams({ q, category: filters.category ?? '', view: staff && filters.view === 'all' ? 'all' : 'published', ...(audience ? { audience } : {}), page: String(next) })}`;
  return (
    <div className="portal-page">
      {viewer.usageSharing && q && !error && page === 1 && (
        <UsageEvent key={q} event="search_performed" surface="knowledge" />
      )}
      <header className="portal-page-heading">
        <div>
          <Link
            className={buttonVariants({ variant: 'quiet', className: 'page-back-link' })}
            href="/app"
          >
            <NavigationIcon name="arrowLeft" className="inline-icon" size={16} />
            Home
          </Link>
          <h1>{staff ? 'Knowledge base' : 'Help articles'}</h1>
          <p>
            {staff
              ? 'Employee guides and internal IT procedures.'
              : 'Answers and guides from your IT team and FixxFlow.'}
          </p>
        </div>
        {viewer.role === 'administrator' && (
          <Link
            className={buttonVariants({ variant: 'secondary' })}
            href="/app/administration/library"
          >
            Manage library guides
          </Link>
        )}
        {staff && (
          <Link className={buttonVariants({ variant: 'primary' })} href="/app/help/new">
            New article
          </Link>
        )}
      </header>
      <LiveSearchForm
        action="/app/help"
        className="queue-filters"
        label={staff ? 'Search knowledge articles' : 'Search help articles'}
        resultSummary={
          error
            ? 'Articles could not load. Use Search to try again.'
            : `${Math.min(data?.length ?? 0, 24)} articles on this page${(data?.length ?? 0) > 24 ? ', with more results available' : ''}.`
        }
      >
        <label>
          Search articles
          <Input
            name="q"
            type="search"
            defaultValue={q}
            maxLength={SEARCH_LIMIT}
            aria-describedby="knowledge-search-hint"
            placeholder="Search by problem, task, or error"
          />
        </label>
        <label>
          Category
          <NativeSelect name="category" defaultValue={filters.category ?? ''}>
            <option value="">All categories</option>
            {knowledgeCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </label>
        {staff && (
          <label>
            Publication status
            <NativeSelect name="view" defaultValue={filters.view ?? 'published'}>
              <option value="published">Published articles</option>
              <option value="all">All, including drafts and archived</option>
            </NativeSelect>
          </label>
        )}
        {staff && (
          <label>
            Audience
            <NativeSelect name="audience" defaultValue={audience}>
              <option value="">All audiences</option>
              {Object.entries(knowledgeAudiences).map(([value, item]) => (
                <option key={value} value={value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        <Button variant="secondary">Search</Button>
        <Link className={buttonVariants({ variant: 'secondary' })} href="/app/help">
          Clear filters
        </Link>
      </LiveSearchForm>
      <details className="portal-search-tips">
        <summary>Search tips</summary>
        <p className="muted" id="knowledge-search-hint">
          {SEARCH_HINT}
        </p>
      </details>
      {!q && !filters.category && (
        <nav className="knowledge-categories" aria-label="Browse help topics">
          {knowledgeCategories.map((category) => (
            <Link
              className="portal-detail-card"
              key={category}
              href={`/app/help?${new URLSearchParams({ category, ...(staff && filters.view === 'all' ? { view: 'all' } : {}), ...(audience ? { audience } : {}) })}`}
            >
              <strong>{category}</strong>
              <span>{knowledgeCategoryDescriptions[category]}</span>
            </Link>
          ))}
        </nav>
      )}
      {error ? (
        <Alert tone="error" role="alert">
          Articles could not be loaded.{' '}
          <Link className={buttonVariants({ variant: 'secondary' })} href={pageHref(page)}>
            Try again
          </Link>
        </Alert>
      ) : (
        <>
          {data?.length ? (
            <div className="portal-articles">
              {data.slice(0, 24).map((a) => (
                <article className="portal-detail-card" key={a.id}>
                  <p className="muted">
                    {a.organization_id === null ? 'FixxFlow library · ' : ''}
                    {a.category}
                    {staff ? ` · ${knowledgeAudiences[a.audience].label}` : ''}
                    {a.status !== 'published' ? ` · ${a.status}` : ''}
                  </p>
                  <h2>
                    <Link href={`/app/help/${a.id}`}>{a.title}</Link>
                  </h2>
                  <p>{a.summary || 'Open this guide to read more.'}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="portal-empty">
              <h2>
                {q || filters.category || audience || page > 1
                  ? 'No articles found'
                  : 'No published guides yet'}
              </h2>
              <p>
                {q || filters.category || audience || page > 1
                  ? 'Try different words or another category.'
                  : staff
                    ? 'Create an article to share useful instructions with your organization.'
                    : 'Your IT team has not published any guides yet. You can still submit a request for help.'}
              </p>
            </div>
          )}
          {(page > 1 || (data?.length ?? 0) > 24) && (
            <nav className="notification-pagination" aria-label="Article pages">
              {page > 1 && (
                <Link
                  className={buttonVariants({ variant: 'secondary' })}
                  href={pageHref(page - 1)}
                >
                  Previous
                </Link>
              )}
              <span>Page {page}</span>
              {(data?.length ?? 0) > 24 && (
                <Link
                  className={buttonVariants({ variant: 'secondary' })}
                  href={pageHref(page + 1)}
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
      <p className="portal-help-footer">
        Still need help? <Link href="/app/tickets/new">Submit a request</Link> or{' '}
        <Link href="/app/support">contact FixxFlow support</Link>.
      </p>
    </div>
  );
}
