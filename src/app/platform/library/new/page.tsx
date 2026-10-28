import { randomUUID } from 'node:crypto';

import { PageHeader } from '@/components/ui/page-header';
import { ArticleEditor } from '@/features/knowledge/article-editor';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { createClient } from '@/lib/supabase/server';

import { saveLibraryArticle } from '../actions';

export default async function NewLibraryArticle() {
  const owner = await requirePlatformOwner();
  const db = await createClient();
  const related = await db
    .from('library_articles')
    .select('id,title,audience')
    .order('title')
    .limit(24);
  if (related.error)
    return (
      <div className="page">
        <h1>Editor unavailable</h1>
        <p role="alert">Could not load article choices. Refresh to retry.</p>
      </div>
    );
  return (
    <div className="page">
      <PageHeader
        title="New shared article"
        eyebrow="FixxFlow library"
        description="Create guidance for every workspace. Start with Draft and IT only. Library articles support text and links."
        back={{ href: '/platform/library', label: 'FixxFlow library' }}
      />
      <ArticleEditor
        library
        isNew
        saveAction={saveLibraryArticle}
        organizationId=""
        assets={[]}
        related={related.data ?? []}
        article={{
          id: randomUUID(),
          organization_id: '',
          title: '',
          summary: '',
          category: 'Accounts',
          content: [{ type: 'paragraph', text: '' }],
          status: 'draft',
          audience: 'it_only',
          related_article_ids: [],
          author_id: owner.id,
          revision: 1,
          search_body: '',
          created_at: '',
          updated_at: '',
        }}
      />
    </div>
  );
}
