import Link from 'next/link';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import type { Viewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import type { LibraryArticle } from '@/types/database';

import { ArticleFeedback } from './article-feedback';
import { knowledgeAudiences } from './audience';
import { LibraryArticleContent } from './library-article-content';

export async function LibraryArticleDetail({
  article,
  viewer,
}: {
  article: LibraryArticle;
  viewer: Pick<Viewer, 'id' | 'organizationId' | 'role'>;
}) {
  const db = await createClient();
  const staff = viewer.role !== 'end_user';
  const [related, feedback, views, helpful, unhelpful] = await Promise.all([
    article.related_article_ids.length
      ? db.from('library_articles').select('id,title').in('id', article.related_article_ids)
      : { data: [], error: null },
    db
      .from('library_article_feedback')
      .select('helpful')
      .eq('organization_id', viewer.organizationId)
      .eq('article_id', article.id)
      .eq('user_id', viewer.id)
      .maybeSingle(),
    ...[null, true, false].map((vote) => {
      if (!staff) return Promise.resolve({ count: null, error: null });
      if (vote === null)
        return db
          .from('library_article_views')
          .select('article_id', { head: true, count: 'exact' })
          .eq('organization_id', viewer.organizationId)
          .eq('article_id', article.id);
      return db
        .from('library_article_feedback')
        .select('article_id', { head: true, count: 'exact' })
        .eq('organization_id', viewer.organizationId)
        .eq('article_id', article.id)
        .eq('helpful', vote);
    }),
  ]);
  return (
    <div className="portal-page knowledge-detail">
      <header className="portal-page-heading">
        <div>
          <Link className="button button-quiet page-back-link" href="/app/help">
            <NavigationIcon name="arrowLeft" className="inline-icon" size={16} />
            Knowledge base
          </Link>
          <p className="muted">
            FixxFlow library · {article.category} · {knowledgeAudiences[article.audience].label}
          </p>
          <h1>{article.title}</h1>
          <p>{article.summary}</p>
        </div>
      </header>
      <p className="muted">Maintained by FixxFlow and shared across workspaces.</p>
      <article className="portal-detail-card">
        <LibraryArticleContent content={article.content} />
      </article>
      {(related.error || !!related.data?.length) && (
        <section className="settings-card">
          <h2>Related articles</h2>
          {related.error ? (
            <p role="alert">Related articles could not load. Refresh to retry.</p>
          ) : (
            <ul>
              {related.data?.map((a) => (
                <li key={a.id}>
                  <Link href={`/app/help/${a.id}`}>{a.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {feedback.error ? (
        <p role="alert">Your saved feedback could not load. Refresh to retry.</p>
      ) : (
        <ArticleFeedback articleId={article.id} initial={feedback.data?.helpful ?? null} library />
      )}
      {staff && (
        <section className="settings-card">
          <h2>Usage in this workspace</h2>
          {views.error || helpful.error || unhelpful.error ? (
            <p role="alert">Insights could not load. Refresh to retry.</p>
          ) : (
            <>
              <dl className="knowledge-metrics">
                <div>
                  <dt>Views</dt>
                  <dd>{views.count ?? 0}</dd>
                </div>
                <div>
                  <dt>Helpful</dt>
                  <dd>{helpful.count ?? 0}</dd>
                </div>
                <div>
                  <dt>Not helpful</dt>
                  <dd>{unhelpful.count ?? 0}</dd>
                </div>
              </dl>
              <p className="muted">
                Views count each signed-in reader once per UTC day. Votes reflect each reader’s
                latest choice. Refresh to see new activity.
              </p>
            </>
          )}
        </section>
      )}
      <section className="settings-card">
        <h2>Still need help?</h2>
        <p>
          Tell IT what happened and which steps you tried. Include this article’s title in your
          request.
        </p>
        <Link className="button button-primary" href="/app/tickets/new">
          Submit a request
        </Link>
      </section>
    </div>
  );
}
