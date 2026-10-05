import { unstable_rethrow } from 'next/navigation';
import { automationPickerChoices } from '@/features/automation/ui-service';

const headers = { 'Cache-Control': 'private, no-store' };

/** Read-only, session/MFA/administrator scoped. Mutations remain Server Actions. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const value = await automationPickerChoices(
      params.get('resource') ?? '', params.get('q') ?? '',
      Number(params.get('page') ?? 1), params.getAll('selected'),
    );
    return Response.json(value, { headers });
  } catch (error) {
    unstable_rethrow(error);
    return Response.json({ error: 'Choices could not load. Try again.' }, { status: 503, headers });
  }
}
