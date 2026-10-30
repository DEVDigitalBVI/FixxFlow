import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';

import { requestPasswordReset } from '../actions';

type Props = { searchParams: Promise<{ error?: string; success?: string }> };
export default async function ForgotPasswordPage({ searchParams }: Props) {
  const message = await searchParams;
  return (
    <section className="auth-card" aria-labelledby="reset-heading">
      <h1 id="reset-heading">Reset your password</h1>
      <p className="auth-intro">We’ll send a secure reset link to your work email.</p>
      <form action={requestPasswordReset} className="stack">
        {message.error && (
          <Alert tone="error" role="alert">
            {message.error}
          </Alert>
        )}
        {message.success && (
          <Alert tone="success" role="status">
            {message.success}
          </Alert>
        )}
        <div className="field">
          <label htmlFor="email">Work email</label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <SubmitButton variant="primary" pendingLabel="Sending link…">
          Send reset link
        </SubmitButton>
        <Link href="/login">Return to sign in</Link>
      </form>
    </section>
  );
}
