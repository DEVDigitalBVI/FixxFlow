'use client';

import { RouteError } from '@/components/route-error';

export default function ErrorBoundary({ retry }: { retry: () => void }) {
  return (
    <RouteError
      retry={retry}
      title="Email announcements could not load"
      message="Try again. Saved drafts and queued emails are kept."
      layout="page"
    />
  );
}
