'use client';

import { useRouter } from 'next/navigation';

import { recordCompletedLogin } from '@/features/product-analytics/actions';

import styles from './authentication.module.css';
import { MfaEnrollment } from './mfa-enrollment';

export function RequiredEnrollment() {
  const router = useRouter();
  return (
    <div className={styles.compact}>
      <MfaEnrollment
        required
        onVerified={async () => {
          await recordCompletedLogin().catch(() => {});
          router.replace('/app');
          router.refresh();
        }}
      />
    </div>
  );
}
