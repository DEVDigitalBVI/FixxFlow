import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

async function session(active = false) {
  try {
    const db = await createClient();
    const result = await db.rpc(active ? 'touch_app_session' : 'app_session_state');
    if (result.error) {
      if (['PGRST301', 'PGRST303', '42501'].includes(result.error.code))
        return Response.json(
          { active: false },
          { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
        );
      throw result.error;
    }
    const state = result.data as { active?: boolean; user_id?: string | null } | null;
    return Response.json(state ?? { active: false }, {
      status: state?.active ? 200 : 401,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    reportServerError('auth.session', error);
    return Response.json(
      { error: 'Session verification unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export async function GET() {
  return session();
}
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return Response.json(
      { error: 'Invalid request origin' },
      { status: 403, headers: { 'Cache-Control': 'private, no-store' } },
    );
  return session(true);
}
