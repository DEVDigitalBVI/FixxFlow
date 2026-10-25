'use client';

import { RouteError } from '@/components/route-error';

export default function ErrorBoundary({ retry }: { retry: () => void }) {
  return (
    <RouteError
      retry={retry}
      title="Reports could not load"
      message="We couldn’t retrieve the report data. Your saved definitions and schedules have not changed."
      layout="narrow"
      back={{ href: '/app', label: 'Back to overview' }}
    />
  );
}
