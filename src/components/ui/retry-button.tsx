'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from './button';

export function RetryButton({ label = 'Try again' }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? 'Retrying…' : label}
    </Button>
  );
}
