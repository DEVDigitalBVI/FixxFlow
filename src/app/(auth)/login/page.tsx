import Link from 'next/link';

import { SubmitButton } from '@/components/ui/submit-button';
import { companyCallback, companyProviders } from '@/features/auth/company-sign-in';
import { CompanySignInButton } from '@/features/auth/company-sign-in-button';

import { signIn } from '../actions';
import { companySignIn } from '../company-actions';

type Props = { searchParams: Promise<{ error?: string; success?: string }> };
export default async function LoginPage({ searchParams }: Props) {
  const message = await searchParams;
  const providers = companyCallback(process.env) ? companyProviders(process.env) : [];
  return (
    <section className="auth-card" aria-labelledby="login-heading">
      <h1 id="login-heading">Welcome back</h1>
      <p className="auth-intro">Sign in to your organization workspace.</p>
      {providers.length > 0 && (
        <div className="stack auth-company-sign-in">
          {providers.map((item) => (
            <form action={companySignIn} key={item.provider}>
              <input type="hidden" name="provider" value={item.provider} />
              <CompanySignInButton provider={item.provider} />
            </form>
          ))}
          <p className="muted">Or sign in with email</p>
        </div>
      )}
      <form action={signIn} className="stack">
        {message.error && (
          <div className="alert alert-error" role="alert">
            {message.error}
          </div>
        )}
        {message.success && (
          <div className="alert alert-success" role="status">
            {message.success}
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input
            className="input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        <div className="field">
          <div className="form-row">
            <label htmlFor="password">Password</label>
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
          <input
            className="input"
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <SubmitButton className="button button-primary" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
      <p className="auth-switch">
        New to FixxFlow? <Link href="/signup">Create an organization</Link>
      </p>
    </section>
  );
}
