import { unstable_rethrow } from 'next/navigation';

import { ArticleChoiceInputError, articleChoices } from '@/features/knowledge/choices';
import { reportServerError } from '@/lib/server-errors';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  try {
    return Response.json(await articleChoices(new URL(request.url).searchParams), { headers });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ArticleChoiceInputError)
      return Response.json({ error: 'Invalid article lookup.' }, { status: 400, headers });
    reportServerError('knowledge.choices', error);
    return Response.json(
      { error: 'Articles could not load. Try again.' },
      { status: 503, headers },
    );
  }
}
