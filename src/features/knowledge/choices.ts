import 'server-only';

import { requirePlatformOwner } from '@/lib/auth/platform';
import { requireViewer } from '@/lib/auth/viewer';
import { normalizeSearch } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

import type { KnowledgeAudience } from './audience';
import { validId } from './content';

export type ArticleChoice = { id: string; title: string; audience?: KnowledgeAudience };
export class ArticleChoiceInputError extends Error {}
export async function articleChoices(params: URLSearchParams) {
  const scope = params.get('scope') ?? 'workspace';
  const rawPage = params.get('page') ?? '1';
  const exclude = params.get('exclude');
  if (
    !['workspace', 'library'].includes(scope) ||
    !/^[1-9]\d{0,3}$/.test(rawPage) ||
    (exclude && !validId(exclude))
  )
    throw new ArticleChoiceInputError();
  let organizationId: string | undefined;
  if (scope === 'library') await requirePlatformOwner();
  else {
    const viewer = await requireViewer();
    if (viewer.role === 'end_user') throw new ArticleChoiceInputError();
    organizationId = viewer.organizationId;
  }
  const db = await createClient();
  let query = db
    .from(scope === 'library' ? 'library_articles' : 'knowledge_articles')
    .select('id,title,audience');
  if (organizationId) query = query.eq('organization_id', organizationId);
  if (exclude) query = query.neq('id', exclude);
  const text = normalizeSearch(params.get('q') ?? '');
  // Literal LIKE fragments: wildcard characters are content, not query syntax.
  if (text) query = query.ilike('title', `%${text.replace(/[\\%_]/g, '\\$&')}%`);
  const page = Number(rawPage);
  const result = await query
    .order('title')
    .order('id')
    .range((page - 1) * 24, page * 24);
  if (result.error) throw result.error;
  return { rows: (result.data ?? []).slice(0, 24), more: (result.data?.length ?? 0) > 24 };
}
