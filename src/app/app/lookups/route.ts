import { reportServerError } from '@/lib/server-errors';
import { unstable_rethrow } from 'next/navigation';
import { lookupChoices, LookupInputError } from '@/features/lookups/service';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try { return Response.json(await lookupChoices(new URL(request.url).searchParams), { headers }); }
  catch (error) {
    unstable_rethrow(error);
    if (error instanceof LookupInputError) return Response.json({ error: 'Invalid lookup request.' }, { status: 400, headers });
    const reference = reportServerError('lookup.load', error);
    return Response.json({ error: 'Choices could not load. Try again.', reference }, { status: 503, headers: { ...headers, 'X-Correlation-ID': reference } });
  }
}
