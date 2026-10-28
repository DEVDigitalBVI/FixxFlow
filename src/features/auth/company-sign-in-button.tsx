import Image from 'next/image';

import { SubmitButton } from '@/components/ui/submit-button';

import type { CompanyProvider } from './company-sign-in';

export function CompanySignInButton({ provider }: { provider: CompanyProvider }) {
  const google = provider === 'google';
  return (
    <SubmitButton
      className={`button company-provider company-provider-${google ? 'google' : 'microsoft'}`}
      pendingLabel="Connecting…"
    >
      <Image
        unoptimized
        src={`/brand/providers/${google ? 'google-g.png' : 'microsoft.svg'}`}
        alt=""
        aria-hidden="true"
        width={google ? 20 : 21}
        height={google ? 20 : 21}
      />
      <span>Sign in with {google ? 'Google' : 'Microsoft'}</span>
    </SubmitButton>
  );
}
