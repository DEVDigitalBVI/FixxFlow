import { unstable_rethrow } from 'next/navigation';

import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

/** Optional search context streams independently of the actionable ticket queue. */
export async function KnowledgeMatchCount({
  organizationId,
  search,
}: {
  organizationId: string;
  search: string;
}) {
  try {
    const db = await createClient();
    const { count, error } = await db
      .rpc(
        'search_knowledge_articles',
        { target_organization_id: organizationId, search_text: search },
        { count: 'exact', head: true },
      )
      .select('id')
      .eq('status', 'published');
    if (error) throw error;
    return count ? ` (${count} ${count === 1 ? 'match' : 'matches'})` : null;
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('knowledge.count', error);
    return null;
  }
}
