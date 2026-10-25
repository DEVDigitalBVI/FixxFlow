'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function RetryButton({ label = 'Try again' }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="button button-secondary"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? 'Retrying…' : label}
    </button>
  );
}
