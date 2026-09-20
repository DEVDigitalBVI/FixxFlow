import { signOut } from "../../actions";
import { bootstrapOrganization } from "../actions";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function UnassignedPage({ searchParams }: Props) {
  const message = await searchParams;
  return <section className="auth-card"><h1>Set up your workspace</h1><p className="auth-intro">If you are the first administrator, create the organization workspace. Otherwise, ask an administrator to add your account.</p><form action={bootstrapOrganization} className="stack">{message.error && <div className="alert alert-error" role="alert">{message.error}</div>}<div className="field"><label htmlFor="organizationName">Organization name</label><input className="input" id="organizationName" name="organizationName" autoComplete="organization" required minLength={2} maxLength={120} /></div><div className="field"><label htmlFor="organizationSlug">Workspace identifier</label><input className="input" id="organizationSlug" name="organizationSlug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" aria-describedby="slug-hint" required /><p className="form-note" id="slug-hint">Lowercase letters, numbers, and hyphens—for example, acme-it.</p></div><div className="field"><label htmlFor="administratorName">Your name</label><input className="input" id="administratorName" name="administratorName" autoComplete="name" required maxLength={120} /></div><button className="button button-primary" type="submit">Create organization</button></form><form action={signOut} style={{ marginTop: 16 }}><button className="link-button" type="submit">Sign out instead</button></form></section>;
}
