import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { SignupProgress } from '@/components/ui/signup-progress';

type Props = { searchParams: Promise<{ email?: string }> };
export default async function CheckEmailPage({ searchParams }: Props) {
  const { email } = await searchParams;
  return (
    <section className="auth-card" aria-labelledby="check-email-heading">
      <SignupProgress current={2} />
      <div className="confirmation-icon" aria-hidden="true">
        ✉
      </div>
      <h1 id="check-email-heading">Check your email</h1>
      <p className="auth-intro">
        We sent a verification link
        {email ? (
          <>
            {' '}
            to <strong>{email}</strong>
          </>
        ) : null}
        . Open it to verify your account and continue setting up your organization.
      </p>
      <div className="confirmation-note">
        <strong>What happens next?</strong>
        <span>
          After verification, you’ll name your organization and become its first administrator.
        </span>
      </div>
      <Link className={buttonVariants({ variant: 'secondary' })} href="/login">
        Return to sign in
      </Link>
    </section>
  );
}
