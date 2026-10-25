import Link from 'next/link';

import { LiveSearchForm } from '@/components/ui/live-search-form';
import { PageHeader } from '@/components/ui/page-header';
import { knowledgeAudiences } from '@/features/knowledge/audience';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { pageNumber } from '@/lib/pagination';
import { normalizeSearch, SEARCH_LIMIT } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; saved?: string }>;
}) {
  await requirePlatformOwner();
  const filters = await searchParams;
  const q = normalizeSearch(filters.q),
    page = pageNumber(filters.page, 10000);
  const db = await createClient();
  const query = q
    ? db
        .rpc('search_knowledge_articles', {
          target_organization_id: '00000000-0000-0000-0000-000000000000',
          search_text: q,
        })
        .select('id,title,summary,status,audience,category,updated_at')
        .is('organization_id', null)
    : db.from('library_articles').select('id,title,summary,status,audience,category,updated_at');
  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .order('id')
    .range((page - 1) * 24, page * 24);
  const href = (next: number) =>
    `/platform/library?${new URLSearchParams({ q, page: String(next) })}`;
  return (
    <div className="page">
      <PageHeader
        title="FixxFlow library"
        description="Maintain shared employee guides and IT procedures. Published updates reach every workspace."
        actions={
          <Link className="button button-primary" href="/platform/library/new">
            New shared article
          </Link>
        }
      />
      {filters.saved && (
        <p className="alert alert-success" role="status">
          Shared article saved.
        </p>
      )}
      <LiveSearchForm
        action="/platform/library"
        className="queue-filters"
        label="Search shared articles"
        resultSummary={
          error
            ? 'Articles could not load.'
            : `${Math.min(data?.length ?? 0, 24)} articles on this page.`
        }
      >
        <label>
          Search shared articles
          <input
            className="input"
            type="search"
            name="q"
            defaultValue={q}
            maxLength={SEARCH_LIMIT}
          />
        </label>
        <button className="button button-secondary">Search</button>
        <Link className="button button-secondary" href="/platform/library">
          Clear filters
        </Link>
      </LiveSearchForm>
      {error ? (
        <p className="alert alert-error" role="alert">
          Articles could not load. <Link href={href(page)}>Try again</Link>
        </p>
      ) : (
        <>
          <div className="portal-articles">
            {data?.slice(0, 24).map((a) => (
              <article className="portal-detail-card" key={a.id}>
                <p className="muted">
                  {a.category} · {knowledgeAudiences[a.audience].label} · {a.status}
                </p>
                <h2>
                  <Link href={`/platform/library/${a.id}/edit`}>{a.title}</Link>
                </h2>
                <p>{a.summary}</p>
              </article>
            ))}
          </div>
          {!data?.length && (
            <p className="portal-empty">
              No shared articles found. Try another search or create an article.
            </p>
          )}
          {(page > 1 || (data?.length ?? 0) > 24) && (
            <nav className="notification-pagination" aria-label="Shared article pages">
              {page > 1 && (
                <Link className="button button-secondary" href={href(page - 1)}>
                  Previous
                </Link>
              )}
              <span>Page {page}</span>
              {(data?.length ?? 0) > 24 && (
                <Link className="button button-secondary" href={href(page + 1)}>
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
