import { unstable_rethrow } from 'next/navigation';

import { searchWorkspace } from '@/features/search/service';
import { reportServerError } from '@/lib/server-errors';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    return Response.json(
      { results: await searchWorkspace(new URL(request.url).searchParams.get('q') ?? '') },
      { headers },
    );
  } catch (error) {
    unstable_rethrow(error);
    reportServerError('workspace.search', error);
    return Response.json({ error: 'Search could not load. Try again.' }, { status: 503, headers });
  }
}
