import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { ArticleEditor } from '@/features/knowledge/article-editor';
import { validId } from '@/features/knowledge/content';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { createClient } from '@/lib/supabase/server';

import { saveLibraryArticle } from '../../actions';

export default async function EditLibraryArticle({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  await requirePlatformOwner();
  const { articleId } = await params;
  if (!validId(articleId)) notFound();
  const db = await createClient();
  const [article, related] = await Promise.all([
    db.from('library_articles').select('*').eq('id', articleId).maybeSingle(),
    db
      .from('library_articles')
      .select('id,title,audience')
      .neq('id', articleId)
      .order('title')
      .limit(200),
  ]);
  if (article.error || related.error)
    return (
      <div className="page">
        <h1>Editor unavailable</h1>
        <p role="alert">Could not load the editor. Refresh to retry.</p>
      </div>
    );
  if (!article.data) notFound();
  const missing = article.data.related_article_ids.filter(
    (id) => !related.data?.some((a) => a.id === id),
  );
  const extra = missing.length
    ? await db.from('library_articles').select('id,title,audience').in('id', missing)
    : { data: [], error: null };
  if (extra.error)
    return (
      <div className="page">
        <p role="alert">Could not load related articles. Refresh to retry.</p>
      </div>
    );
  return (
    <div className="page">
      <PageHeader
        title="Edit shared article"
        eyebrow="FixxFlow library"
        description="Saving a published article updates it in every workspace. Use Draft to withdraw it while revising. Library articles support text and links."
        back={{ href: '/platform/library', label: 'FixxFlow library' }}
      />
      <ArticleEditor
        library
        saveAction={saveLibraryArticle}
        organizationId=""
        article={{ ...article.data, organization_id: '' }}
        assets={[]}
        related={[...(related.data ?? []), ...(extra.data ?? [])]}
      />
    </div>
  );
}
