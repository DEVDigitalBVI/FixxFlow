'use client';

import { RouteError } from '@/components/route-error';

export default function ErrorBoundary({ retry }: { retry: () => void }) {
  return (
    <RouteError
      retry={retry}
      title="Automations could not load"
      message="Try again. This page load has not changed your automations."
      layout="card"
    />
  );
}
