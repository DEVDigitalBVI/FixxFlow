import Link from 'next/link';
import { redirect } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { MfaChallenge } from '@/features/auth/mfa-challenge';
import { MfaEnrollment } from '@/features/auth/mfa-enrollment';
import { platformIdentity } from '@/lib/auth/platform';

export default async function PlatformAccessPage() {
  const owner = await platformIdentity();
  if (owner.access === 'ready') redirect('/platform');
  return (
    <div className="page page-narrow">
      <PageHeader
        title="Secure your owner account"
        description="Platform access requires an authenticator and a verified session."
      />
      <section className="settings-card stack">
        {owner.access === 'verify' ? (
          <MfaChallenge destination="/platform" />
        ) : (
          <>
            <MfaEnrollment />
            <Link className={buttonVariants({ variant: 'primary' })} href="/platform">
              Continue after enabling your authenticator
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
