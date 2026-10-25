import Link from 'next/link';

import { createClient } from '@/lib/supabase/server';
import type { LibraryArticle } from '@/types/database';

import { ArticleContent } from './article-content';
import { knowledgeAudiences } from './audience';

export async function LibraryArticleDetail({ article }: { article: LibraryArticle }) {
  const db = await createClient();
  const related = article.related_article_ids.length
    ? await db.from('library_articles').select('id,title').in('id', article.related_article_ids)
    : { data: [], error: null };
  return (
    <div className="portal-page knowledge-detail">
      <header className="portal-page-heading">
        <div>
          <Link className="button button-quiet page-back-link" href="/app/help">
            ← Knowledge base
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
        <ArticleContent content={article.content} showContents />
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
