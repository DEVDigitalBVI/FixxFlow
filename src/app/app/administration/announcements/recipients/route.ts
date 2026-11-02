import { unstable_rethrow } from 'next/navigation';

import { requireWorkspaceAccess } from '@/lib/auth/viewer';
import { pageNumber } from '@/lib/pagination';
import { normalizeSearch } from '@/lib/search';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const viewer = await requireWorkspaceAccess();
    if (viewer.role !== 'administrator')
      return Response.json({ error: 'Administrator required' }, { status: 403, headers });
    const params = new URL(request.url).searchParams;
    const db = await createClient();
    const result = await db.rpc('email_announcement_choices', {
      org: viewer.organizationId,
      query: normalizeSearch(params.get('q') ?? ''),
      page: pageNumber(params.get('page') ?? undefined, 10000),
    });
    if (result.error || !result.data) throw result.error ?? Error('Members unavailable');
    return Response.json(result.data, { headers });
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('email-announcement.prepare', error);
    return Response.json({ error: 'Members could not load. Try again.' }, { status: 503, headers });
  }
}
