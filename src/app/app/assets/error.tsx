'use client';

import { RouteError } from '@/components/route-error';

export default function ErrorBoundary({ retry }: { retry: () => void }) {
  return (
    <RouteError
      retry={retry}
      title="Assets could not load"
      message="Please try again. Your assets have not changed."
      layout="page"
    />
  );
}
