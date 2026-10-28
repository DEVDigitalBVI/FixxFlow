import type { SupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

import { readAccountPolicy } from '@/features/auth/workspace-policy';

export async function requireAssurance(supabase: SupabaseClient) {
  const [assurance, policyResult] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc('account_authentication_policy'),
  ]);
  const { data, error } = assurance;
  const policy = readAccountPolicy(policyResult.data);
  if (policyResult.error || !policy)
    redirect('/login?error=Could%20not%20verify%20workspace%20protection.%20Please%20try%20again.');
  if (policy.mfa_required && !policy.has_verified_factor) redirect('/auth/enroll');
  if (error || !data?.currentLevel)
    redirect('/login?error=Could%20not%20verify%20your%20session.%20Please%20sign%20in%20again.');
  if (data.currentLevel !== 'aal2' && (policy.mfa_required || data.nextLevel === 'aal2'))
    redirect('/auth/mfa');
}
