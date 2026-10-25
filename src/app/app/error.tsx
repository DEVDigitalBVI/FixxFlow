'use client';

import { RouteError } from '@/components/route-error';

export default function ErrorBoundary({ retry }: { retry: () => void }) {
  return (
    <RouteError
      retry={retry}
      title="This page could not load"
      message="We couldn’t retrieve the information for this page. Please try again."
      layout="narrow"
      back={{ href: '/app', label: 'Back to overview' }}
    />
  );
}
