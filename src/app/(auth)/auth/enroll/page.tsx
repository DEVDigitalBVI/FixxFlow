import { redirect } from 'next/navigation';

import { RequiredEnrollment } from '@/features/auth/required-enrollment';
import { readAccountPolicy } from '@/features/auth/workspace-policy';
import { createClient } from '@/lib/supabase/server';

import { signOut } from '../../actions';

export default async function EnrollPage() {
  const db = await createClient();
  const claims = await db.auth.getClaims();
  if (claims.error || !claims.data?.claims.sub) redirect('/login');
  const result = await db.rpc('account_authentication_policy');
  const policy = readAccountPolicy(result.data);
  if (result.error || !policy)
    throw new Error('Workspace protection could not load. Please try again.');
  if (!policy.mfa_required) redirect('/app/security');
  if (policy.has_verified_factor) {
    const level = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level.error) throw new Error('Verification could not load.');
    redirect(level.data?.currentLevel === 'aal2' ? '/app' : '/auth/mfa');
  }
  return (
    <section className="auth-card" aria-labelledby="enroll-heading">
      <h1 id="enroll-heading">Set up your authenticator</h1>
      <p className="auth-intro">
        Your workspace requires two-step verification before you can continue.
      </p>
      <RequiredEnrollment />
      <form action={signOut}>
        <button className="button button-secondary">Sign out</button>
      </form>
    </section>
  );
}
