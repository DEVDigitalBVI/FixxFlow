import 'server-only';

import { isKnowledgeAudience, knowledgeAudiences } from '@/features/knowledge/audience';
import { requireViewer } from '@/lib/auth/viewer';
import { normalizeSearch } from '@/lib/search';
import { createClient } from '@/lib/supabase/server';

import { SEARCH_RESULT_LIMIT, type SearchResult } from './model';

export async function searchWorkspace(raw: string): Promise<SearchResult[]> {
  const viewer = await requireViewer();
  const q = normalizeSearch(raw);
  if (!q) return [];
  const { data, error } = await (
    await createClient()
  ).rpc('search_workspace', {
    org: viewer.organizationId,
    search_text: q,
  });
  if (error || !data) throw new Error('Search unavailable');
  return data.slice(0, SEARCH_RESULT_LIMIT).flatMap((row) => {
    if (row.kind === 'person' && viewer.role === 'end_user') return [];
    const group =
      row.kind === 'ticket'
        ? 'Tickets'
        : row.kind === 'person'
          ? 'People'
          : row.kind === 'article'
            ? 'Articles'
            : null;
    if (!group) return [];
    return [
      {
        id: row.id,
        group,
        label: row.label,
        approximate: row.approximate,
        detail:
          row.kind === 'article'
            ? [
                row.shared ? 'FixxFlow library' : '',
                viewer.role !== 'end_user' && isKnowledgeAudience(row.audience)
                  ? knowledgeAudiences[row.audience].label
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : row.detail,
        href:
          row.kind === 'ticket'
            ? `/app/tickets/${row.id}`
            : row.kind === 'article'
              ? `/app/help/${row.id}`
              : `/app/people?${new URLSearchParams({ q: row.detail || row.label })}`,
      } as SearchResult,
    ];
  });
}
