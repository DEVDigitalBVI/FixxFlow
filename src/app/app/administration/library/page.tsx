import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { knowledgeAudiences } from '@/features/knowledge/audience';
import { LibraryVisibilityButton } from '@/features/knowledge/library-visibility-button';
import { requireViewer } from '@/lib/auth/viewer';
import { pageNumber } from '@/lib/pagination';
import { normalizeSearch } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

export default async function WorkspaceLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  const filters = await searchParams;
  const q = normalizeSearch(filters.q);
  const page = pageNumber(filters.page, 10000);
  const result = await (
    await createClient()
  ).rpc('workspace_library_choices', { org: viewer.organizationId, query: q, page_number: page });
  const rows = result.data?.slice(0, 24) ?? [];
  const href = (next: number) =>
    `/app/administration/library?${new URLSearchParams({ q, page: String(next) })}`;
  return (
    <div className="page stack">
      <PageHeader
        title="FixxFlow library"
        description="Choose which shared guides apply to your workspace. Hidden guides stay available here so you can restore them."
        back={{ href: '/app/administration', label: 'Settings' }}
      />
      <form className="queue-filters" action="/app/administration/library">
        <label>
          Search shared guides
          <Input type="search" name="q" defaultValue={q} maxLength={200} />
        </label>
        <Button variant="secondary">Search</Button>
      </form>
      {result.error ? (
        <Alert as="p" tone="error" role="alert">
          Library guides could not load. Use Search to retry.
        </Alert>
      ) : rows.length ? (
        <>
          <ul className="knowledge-library-management">
            {rows.map((article) => (
              <li key={article.id} className="settings-card">
                <h2>{article.title}</h2>
                <p>{article.summary}</p>
                <p className="muted">
                  {article.category} · {knowledgeAudiences[article.audience].label}
                </p>
                <LibraryVisibilityButton
                  articleId={article.id}
                  title={article.title}
                  initialHidden={article.hidden}
                />
              </li>
            ))}
          </ul>
          <nav className="knowledge-actions" aria-label="Library pages">
            {page > 1 && (
              <Link className={buttonVariants({ variant: 'secondary' })} href={href(page - 1)}>
                Previous
              </Link>
            )}
            <span>Page {page}</span>
            {(result.data?.length ?? 0) > 24 && (
              <Link className={buttonVariants({ variant: 'secondary' })} href={href(page + 1)}>
                Next
              </Link>
            )}
          </nav>
        </>
      ) : (
        <p>No matching shared guides found.</p>
      )}
    </div>
  );
}
