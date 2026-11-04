import type { Metadata } from 'next';
import Link from 'next/link';

import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';

import { continuePasswordRecovery } from './actions';

export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>;
}) {
  const { token_hash } = await searchParams;
  return (
    <section className="auth-card" aria-labelledby="recovery-heading">
      <h1 id="recovery-heading">Choose a new password</h1>
      <p className="auth-intro">
        Continue to verify your reset link, then enter a new password. Reset links are valid for 24
        hours and can be used once.
      </p>
      <ActionForm action={continuePasswordRecovery} className="stack" protectDraft={false}>
        <input type="hidden" name="token_hash" value={token_hash ?? ''} />
        <SubmitButton variant="primary" pendingLabel="Checking reset link…">
          Continue to password reset
        </SubmitButton>
      </ActionForm>
      <p>
        <Link href="/forgot-password">Request a new reset link</Link>
      </p>
      <p>
        <Link href="/login">Return to sign in</Link>
      </p>
    </section>
  );
}
