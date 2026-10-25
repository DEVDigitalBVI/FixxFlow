'use client';

import { RouteError } from '@/components/route-error';

export default function ErrorBoundary({ retry }: { retry: () => void }) {
  return (
    <RouteError
      retry={retry}
      title="Platform console could not load"
      message="Please try again. Your settings have not changed."
      layout="page"
    />
  );
}
