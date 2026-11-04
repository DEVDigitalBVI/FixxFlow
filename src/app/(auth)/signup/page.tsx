import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SignupProgress } from '@/components/ui/signup-progress';
import { SubmitButton } from '@/components/ui/submit-button';
import { PasswordFields } from '@/features/auth/password-fields';

import { signUp } from '../actions';

type Props = { searchParams: Promise<{ error?: string }> };
export default async function SignupPage({ searchParams }: Props) {
  const message = await searchParams;
  return (
    <section className="auth-card auth-card-wide" aria-labelledby="signup-heading">
      <SignupProgress current={1} />
      <span className="page-eyebrow">Start your workspace</span>
      <h1 id="signup-heading">Create your organization</h1>
      <p className="auth-intro">
        First, create your administrator account. You’ll name your workspace after verifying your
        email.
      </p>
      <form action={signUp} className="stack">
        {message.error && (
          <Alert tone="error" role="alert" tabIndex={-1}>
            {message.error}
          </Alert>
        )}
        <div className="field">
          <label htmlFor="fullName">Your name</label>
          <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="email">Work email</label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
          <p className="form-note">We’ll send your verification link here.</p>
        </div>
        <PasswordFields label="Password" columns />
        <label className="check-field">
          <Checkbox name="terms" value="accepted" required />
          <span>I agree to the Terms of Service and Privacy Policy.</span>
        </label>
        <SubmitButton variant="primary" pendingLabel="Creating account…">
          Create administrator account
        </SubmitButton>
      </form>
      <p className="auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </section>
  );
}
