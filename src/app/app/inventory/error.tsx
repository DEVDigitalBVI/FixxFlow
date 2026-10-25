'use client';

import { RouteError } from '@/components/route-error';

export default function ErrorBoundary({ retry }: { retry: () => void }) {
  return (
    <RouteError
      retry={retry}
      title="Inventory could not load"
      message="Try again to load the latest stock and request progress."
      layout="page"
    />
  );
}
