import { notFound } from 'next/navigation';

import { PageHeader } from '@/components/ui/page-header';
import { WorkspaceSecurityForm } from '@/features/auth/workspace-security-form';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function WorkspaceSecurityPage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'administrator') notFound();
  const db = await createClient();
  const [policy, account, assurance] = await Promise.all([
    db
      .from('workspace_security_policies')
      .select('*')
      .eq('organization_id', viewer.organizationId)
      .maybeSingle(),
    db.rpc('account_authentication_policy'),
    db.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (policy.error || account.error || assurance.error)
    throw new Error('Workspace protection could not load. Please try again.');
  return (
    <div className="page">
      <PageHeader
        title="Workspace security"
        description="Manage sign-in protection for your organization."
        back={{ href: '/app/administration', label: 'Back to settings' }}
      />
      <section className="settings-card">
        <h2>Two-step verification</h2>
        <WorkspaceSecurityForm
          required={policy.data?.require_mfa ?? false}
          revision={policy.data?.revision ?? 0}
          canChange={
            assurance.data?.currentLevel === 'aal2' &&
            account.data?.[0]?.has_verified_factor === true
          }
        />
      </section>
    </div>
  );
}
