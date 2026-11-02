import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { PageHeader } from '@/components/ui/page-header';
import { helpArticleHref, helpTopics, isHelpTopic } from '@/features/knowledge/help-collections';
import { HelpNavigation } from '@/features/knowledge/help-navigation';
import { LibraryArticleContent } from '@/features/knowledge/library-article-content';
import { requireViewer } from '@/lib/auth/viewer';
import { pageNumber } from '@/lib/pagination';
import { normalizeSearch, SEARCH_LIMIT } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

export default async function FaqPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    topic?: string;
    audience?: string;
    format?: string;
    page?: string;
  }>;
}) {
  const viewer = await requireViewer();
  const filters = await searchParams;
  const staff = viewer.role !== 'end_user';
  const audience = staff && filters.audience !== 'employees' ? 'it_only' : 'employees';
  const q = normalizeSearch(filters.q);
  const topic = isHelpTopic(filters.topic) ? filters.topic : '';
  const format = filters.format === 'faq' || filters.format === 'guide' ? filters.format : '';
  const page = pageNumber(filters.page, 10000);
  const db = await createClient();
  const source = q
    ? db.rpc('search_knowledge_articles', {
        target_organization_id: viewer.organizationId,
        search_text: q,
      })
    : db.from('readable_knowledge_articles');
  let query = source
    .select('id,title,summary,content,help_collection,help_topic,help_format,audience')
    .is('organization_id', null)
    .eq('help_collection', 'fixxflow')
    .eq('status', 'published')
    .eq('audience', audience);
  if (topic) query = query.eq('help_topic', topic);
  if (format) query = query.eq('help_format', format);
  const [result, started] = await Promise.all([
    query
      .order('help_format')
      .order('title')
      .order('id')
      .range((page - 1) * 24, page * 24),
    !q && !topic && !format && page === 1
      ? db
          .from('library_articles')
          .select('id,title,summary,help_collection')
          .eq('help_collection', 'fixxflow')
          .eq('help_topic', 'getting-started')
          .eq('help_format', 'guide')
          .eq('status', 'published')
          .eq('audience', audience)
          .order('title')
          .order('id')
          .limit(3)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const rows = result.data?.slice(0, 24) ?? [];
  const faqs = rows.filter((row) => row.help_format === 'faq');
  const featuredIds = new Set((started.data ?? []).map((row) => row.id));
  const guides = rows.filter((row) => row.help_format !== 'faq' && !featuredIds.has(row.id));
  const href = (changes: Record<string, string>) =>
    `/app/faq?${new URLSearchParams({ q, topic, audience, format, ...changes })}`;
  return (
    <div className="portal-page fixxflow-help-page">
      <PageHeader
        title="FixxFlow Help & FAQ"
        eyebrow="Using FixxFlow"
        description="Answers and step-by-step guides for using your workspace."
        back={{ href: '/app', label: 'Home' }}
        actions={
          viewer.role === 'administrator' ? (
            <Link
              className={buttonVariants({ variant: 'secondary' })}
              href="/app/administration/library"
            >
              Manage shared guides
            </Link>
          ) : undefined
        }
      />
      <div className="fixxflow-help-navigation">
        <HelpNavigation current="fixxflow" />
        {staff ? (
          <nav className="queue-views" aria-label="FAQ audience">
            <Link
              className={buttonVariants({ variant: 'secondary' })}
              href={href({ audience: 'employees', page: '1' })}
              aria-current={audience === 'employees' ? 'page' : undefined}
            >
              For employees
            </Link>
            <Link
              className={buttonVariants({ variant: 'secondary' })}
              href={href({ audience: 'it_only', page: '1' })}
              aria-current={audience === 'it_only' ? 'page' : undefined}
            >
              For IT support
            </Link>
          </nav>
        ) : (
          <p className="muted">
            Help for employees · Your IT team’s troubleshooting articles are in the{' '}
            <Link href="/app/help">Knowledge base</Link>.
          </p>
        )}
      </div>
      <LiveSearchForm
        action="/app/faq"
        className="queue-filters"
        label="Search FixxFlow Help and FAQ"
        resultSummary={
          result.error
            ? 'Help could not load. Search again to retry.'
            : `${rows.length} answers and guides on this page${(result.data?.length ?? 0) > 24 ? ', with more available' : ''}.`
        }
      >
        <input type="hidden" name="audience" value={audience} />
        <label>
          Search FixxFlow help
          <Input
            type="search"
            name="q"
            defaultValue={q}
            maxLength={SEARCH_LIMIT}
            placeholder="Try tickets, teams, or account access"
          />
        </label>
        <label>
          Topic
          <NativeSelect name="topic" defaultValue={topic}>
            <option value="">All topics</option>
            {Object.entries(helpTopics)
              .filter(([key]) => staff || !['administration', 'automations'].includes(key))
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </NativeSelect>
        </label>
        <label>
          Content
          <NativeSelect name="format" defaultValue={format}>
            <option value="">FAQs and guides</option>
            <option value="faq">Quick answers</option>
            <option value="guide">Full guides</option>
          </NativeSelect>
        </label>
        <Button variant="secondary">Search</Button>
        <Link
          className={buttonVariants({ variant: 'quiet' })}
          href={`/app/faq?audience=${audience}`}
        >
          Clear filters
        </Link>
      </LiveSearchForm>
      {started.error ? (
        <Alert tone="error" role="alert">
          Getting started guides could not load. <Link href={href({ page: '1' })}>Try again</Link>.
        </Alert>
      ) : (
        !!started.data?.length && (
          <section className="stack" aria-labelledby="faq-start-heading">
            <h2 id="faq-start-heading">
              Getting started {audience === 'it_only' ? 'for IT support' : 'with FixxFlow'}
            </h2>
            <div className="portal-articles">
              {started.data.map((article) => (
                <article className="portal-detail-card" key={article.id}>
                  <h3>
                    <Link href={helpArticleHref(article)}>{article.title}</Link>
                  </h3>
                  <p>{article.summary}</p>
                </article>
              ))}
            </div>
          </section>
        )
      )}
      {result.error ? (
        <Alert tone="error" role="alert">
          FixxFlow help could not be loaded.{' '}
          <Link
            className={buttonVariants({ variant: 'secondary' })}
            href={href({ page: String(page) })}
          >
            Try again
          </Link>
        </Alert>
      ) : (
        <>
          {!!faqs.length && (
            <section className="stack" aria-labelledby="faq-answers-heading">
              <h2 id="faq-answers-heading">Frequently asked questions</h2>
              <div className="fixxflow-faq-list">
                {faqs.map((article) => (
                  <details className="fixxflow-faq-item" key={article.id}>
                    <summary>{article.title}</summary>
                    <div className="fixxflow-faq-answer">
                      <LibraryArticleContent content={article.content} />
                      <Link href={helpArticleHref(article)}>Full answer and related guides</Link>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          )}
          {!!guides.length && (
            <section className="stack" aria-labelledby="faq-guides-heading">
              <h2 id="faq-guides-heading">FixxFlow guides</h2>
              <div className="portal-articles">
                {guides.map((article) => (
                  <article className="portal-detail-card" key={article.id}>
                    <p className="muted">
                      {isHelpTopic(article.help_topic)
                        ? helpTopics[article.help_topic]
                        : 'FixxFlow'}
                    </p>
                    <h3>
                      <Link href={helpArticleHref(article)}>{article.title}</Link>
                    </h3>
                    <p>{article.summary || 'Open the full guide.'}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
          {!rows.length && (
            <section className="portal-empty">
              <h2>No FixxFlow help found</h2>
              <p>
                Try another topic or search term.{' '}
                {staff
                  ? 'Switch audiences to browse employee guidance.'
                  : 'Your IT team can still help you.'}
              </p>
            </section>
          )}
          {(page > 1 || (result.data?.length ?? 0) > 24) && (
            <nav className="notification-pagination" aria-label="FixxFlow help pages">
              {page > 1 && (
                <Link
                  className={buttonVariants({ variant: 'secondary' })}
                  href={href({ page: String(page - 1) })}
                >
                  Previous
                </Link>
              )}
              <span>Page {page}</span>
              {(result.data?.length ?? 0) > 24 && (
                <Link
                  className={buttonVariants({ variant: 'secondary' })}
                  href={href({ page: String(page + 1) })}
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
      <p className="portal-help-footer">
        Still need help? <Link href="/app/tickets/new">Ask your IT team</Link>
        {staff && (
          <>
            {' '}
            or <Link href="/app/support">contact FixxFlow support</Link>
          </>
        )}
        .
      </p>
    </div>
  );
}
