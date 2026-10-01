import { PageHeader } from "@/components/ui/page-header";
import { MfaEnrollment } from "@/features/auth/mfa-enrollment";
import { requireViewer } from "@/lib/auth/viewer";

export default async function SecurityPage() {
  await requireViewer();
  return <div className="page"><PageHeader title="Security" eyebrow="Account" description="Protect your FixxFlow account with an additional verification factor."/><section className="settings-card"><h2>Multi-factor authentication</h2><p className="muted">Use an authenticator app as a second step when signing in. Add a second factor as a backup before removing your primary factor.</p><MfaEnrollment /></section></div>;
}
