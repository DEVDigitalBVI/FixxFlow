import Link from "next/link";

type Props = { searchParams: Promise<{ email?: string }> };
export default async function CheckEmailPage({ searchParams }: Props) {
  const { email } = await searchParams;
  return <section className="auth-card" aria-labelledby="check-email-heading"><div className="onboarding-progress" aria-label="Signup progress"><span className="is-complete">✓</span><i/><span className="is-current">2</span><i/><span>3</span></div><div className="confirmation-icon" aria-hidden="true">✉</div><h1 id="check-email-heading">Check your email</h1><p className="auth-intro">We sent a verification link{email ? <> to <strong>{email}</strong></> : null}. Open it to verify your account and continue setting up your organization.</p><div className="confirmation-note"><strong>What happens next?</strong><span>After verification, you’ll name your organization and become its first administrator.</span></div><Link className="button button-secondary" href="/login">Return to sign in</Link></section>;
}
