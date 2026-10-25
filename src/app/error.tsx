'use client';

import { RouteError } from '@/components/route-error';

export default function ErrorBoundary({ retry }: { retry: () => void }) {
  return (
    <RouteError
      retry={retry}
      title="Your workspace could not load"
      message="We could not verify your account information. Please try again."
      layout="main"
      back={{ href: '/login', label: 'Back to sign in' }}
    />
  );
}
