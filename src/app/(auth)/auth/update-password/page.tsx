import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { SubmitButton } from '@/components/ui/submit-button';
import { PasswordFields } from '@/features/auth/password-fields';
import { createClient } from '@/lib/supabase/server';

import { updatePassword } from '../../actions';

type Props = { searchParams: Promise<{ error?: string }> };
export default async function UpdatePasswordPage({ searchParams }: Props) {
  const message = await searchParams;
  const db = await createClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user)
    return (
      <section className="auth-card">
        <h1>Open a fresh password link</h1>
        <p role="alert">
          Your account setup or password-reset session is no longer available. Request a new link to
          continue.
        </p>
        <Link href="/forgot-password">Request a password-reset link</Link>
        <p>
          <Link href="/login">Return to sign in</Link>
        </p>
      </section>
    );
  return (
    <section className="auth-card" aria-labelledby="password-heading">
      <h1 id="password-heading">Choose a new password</h1>
      <p className="auth-intro">Choose a unique password. The checklist updates as you type.</p>
      <form action={updatePassword} className="stack">
        {message.error && (
          <Alert tone="error" role="alert">
            {message.error}
          </Alert>
        )}
        <PasswordFields />
        <SubmitButton variant="primary" pendingLabel="Updating password…">
          Update password
        </SubmitButton>
      </form>
      <p>
        <Link href="/forgot-password">Request a new password-reset link</Link>
      </p>
    </section>
  );
}
