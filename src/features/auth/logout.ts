import 'server-only';

import { cookies } from 'next/headers';

import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

/** The database receipt blocks access even if Auth sign-out is temporarily unavailable. */
export async function endCurrentSession(schedule?: (task: () => Promise<void>) => void) {
  let userId: string | null = null;
  let revoked = false;
  let providerRevoked = false;
  try {
    const db = await createClient();
    try {
      const claims = await db.auth.getClaims();
      userId = typeof claims.data?.claims?.sub === 'string' ? claims.data.claims.sub : null;
    } catch (error) {
      reportServerError('auth.signout', error);
    }
    try {
      const result = await db.rpc('revoke_app_session');
      revoked = !result.error && result.data === true;
      if (result.error) reportServerError('auth.signout', result.error);
    } catch (error) {
      reportServerError('auth.signout', error);
    }
    try {
      // Once the durable receipt blocks this session at every database boundary,
      // finish the provider request after responding. Capture only the token now:
      // cookies are removed below and cannot be read or written after the response.
      const token =
        revoked && schedule ? (await db.auth.getSession()).data.session?.access_token : null;
      if (token && schedule) {
        schedule(async () => {
          try {
            const result = await db.auth.admin.signOut(token, 'local');
            if (result.error) reportServerError('auth.signout', result.error);
          } catch (error) {
            reportServerError('auth.signout', error);
          }
        });
      } else {
        const result = await db.auth.signOut({ scope: 'local' });
        providerRevoked = !result.error;
        if (result.error) reportServerError('auth.signout', result.error);
      }
    } catch (error) {
      reportServerError('auth.signout', error);
    }
  } catch (error) {
    reportServerError('auth.signout', error);
  }
  // Remove every chunk and the PKCE verifier, including when a provider call fails.
  const jar = await cookies();
  for (const cookie of jar.getAll())
    if (cookie.name.startsWith('sb-')) jar.set(cookie.name, '', { path: '/', maxAge: 0 });
  return { userId, revoked: revoked || providerRevoked };
}
