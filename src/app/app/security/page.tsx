import { PageHeader } from '@/components/ui/page-header';
import { MfaEnrollment } from '@/features/auth/mfa-enrollment';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function SecurityPage() {
  await requireViewer();
  const db = await createClient();
  const { data, error } = await db.rpc('account_authentication_policy');
  if (error || !data?.length) throw new Error('Account protection could not load.');
  return (
    <div className="page">
      <PageHeader
        title="Security"
        eyebrow="Account"
        description="Protect your FixxFlow account with an additional verification factor."
      />
      <section className="settings-card">
        <h2>Multi-factor authentication</h2>
        <p className="muted">
          Use an authenticator app as a second step when signing in. Add a second factor as a backup
          before removing your primary factor.
        </p>
        <MfaEnrollment required={data[0].mfa_required} />
      </section>
    </div>
  );
}
