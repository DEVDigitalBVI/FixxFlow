import { MfaEnrollment } from "@/features/auth/mfa-enrollment";
import { requireViewer } from "@/lib/auth/viewer";

export default async function SecurityPage() {
  await requireViewer();
  return <div className="page"><header className="page-header"><div><span className="page-eyebrow">Account</span><h1>Security</h1><p>Protect your FixxFlow account with an additional verification factor.</p></div></header><section className="settings-card"><h2>Multi-factor authentication</h2><p className="muted">Use an authenticator app as a second step when signing in. Add a second factor as a backup before removing your primary factor.</p><MfaEnrollment /></section></div>;
}
