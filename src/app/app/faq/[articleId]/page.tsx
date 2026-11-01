import { notFound } from 'next/navigation';

import { validId } from '@/features/knowledge/content';
import { LibraryArticleDetail } from '@/features/knowledge/library-article-detail';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function FaqArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const viewer = await requireViewer();
  const { articleId } = await params;
  if (!validId(articleId)) notFound();
  const db = await createClient();
  const { data, error } = await db
    .from('library_articles')
    .select('*')
    .eq('id', articleId)
    .eq('help_collection', 'fixxflow')
    .eq('status', 'published')
    .maybeSingle();
  if (error) throw new Error('FixxFlow help could not load. Please try again.');
  if (!data) notFound();
  return <LibraryArticleDetail article={data} viewer={viewer} />;
}
