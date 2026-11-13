import { unstable_rethrow } from 'next/navigation';

import { requireWorkspaceAccess } from '@/lib/auth/viewer';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    const viewer = await requireWorkspaceAccess();
    if (viewer.role === 'end_user')
      return Response.json({ error: 'IT staff access required.' }, { status: 403, headers });
    const parameters = new URL(request.url).searchParams;
    const kind = parameters.get('kind');
    if (
      parameters.getAll('kind').length !== 1 ||
      ![...parameters.keys()].every((key) => key === 'kind') ||
      !['tags', 'saved-replies'].includes(kind ?? '')
    )
      return Response.json({ error: 'Invalid ticket choices.' }, { status: 400, headers });
    const db = await createClient();
    if (kind === 'tags') {
      const { data, error } = await db.rpc('ticket_tag_suggestions', {
        org: viewer.organizationId,
      });
      if (error) throw error;
      return Response.json({ items: (data ?? []).map((row) => row.tag) }, { headers });
    }
    const { data, error } = await db
      .from('saved_replies')
      .select('id, title, body')
      .eq('organization_id', viewer.organizationId)
      .order('title')
      .order('id')
      .limit(200);
    if (error) throw error;
    return Response.json({ items: data ?? [] }, { headers });
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('ticket.load', error);
    return Response.json({ error: 'Choices could not load. Try again.' }, { status: 503, headers });
  }
}
