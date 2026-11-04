import type { Metadata } from 'next';
import Link from 'next/link';

import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';

import { acceptInvitation } from './actions';

export const metadata: Metadata = {
  title: 'Accept invitation',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; token?: string }>;
}) {
  const { id, token } = await searchParams;
  return (
    <section className="auth-card" aria-labelledby="invitation-heading">
      <h1 id="invitation-heading">Join your FixxFlow workspace</h1>
      <p className="auth-intro">
        Continue to accept your invitation and choose a password. Invitation links are valid for 72
        hours and can be used once.
      </p>
      <ActionForm action={acceptInvitation} className="stack" protectDraft={false}>
        <input type="hidden" name="id" value={id ?? ''} />
        <input type="hidden" name="token" value={token ?? ''} />
        <SubmitButton variant="primary" pendingLabel="Checking invitation…">
          Continue and choose password
        </SubmitButton>
      </ActionForm>
      <p className="muted">
        Already set up your account? <Link href="/login">Sign in</Link> or{' '}
        <Link href="/forgot-password">reset your password</Link>. For an expired invitation, ask
        your workspace administrator to send a new one.
      </p>
    </section>
  );
}
