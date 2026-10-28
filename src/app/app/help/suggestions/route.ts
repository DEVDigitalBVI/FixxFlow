import { unstable_rethrow } from 'next/navigation';

import { requireViewer } from '@/lib/auth/viewer';
import { normalizeSearch } from '@/lib/search';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const viewer = await requireViewer();
    const params = new URL(request.url).searchParams;
    const query = normalizeSearch(params.get('q') ?? '');
    const category = normalizeSearch(params.get('category') ?? '');
    if (query.length < 3 && !category) return Response.json({ rows: [] }, { headers });
    const result = await (
      await createClient()
    ).rpc('suggest_knowledge_articles', {
      org: viewer.organizationId,
      query,
      category_name: category,
    });
    if (result.error) throw result.error;
    return Response.json({ rows: result.data ?? [] }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('knowledge.suggestions', error);
    return Response.json(
      { error: 'Guides could not load. You can still submit your request.' },
      { status: 503, headers },
    );
  }
}
