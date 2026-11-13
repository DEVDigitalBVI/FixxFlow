import { unstable_rethrow } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { RetryButton } from '@/components/ui/retry-button';
import { Skeleton } from '@/components/ui/skeleton';

import { PanelBoundary } from './panel-boundary';

export async function SafeTicketPanel({
  load,
  label,
}: {
  load: () => Promise<ReactNode>;
  label: string;
}) {
  try {
    return await load();
  } catch (error) {
    unstable_rethrow(error);
    return (
      <section className="settings-card">
        <p role="alert">
          {label} could not load. <RetryButton />
        </p>
      </section>
    );
  }
}
export function TicketPanel({
  load,
  label,
  fallback,
}: {
  load: () => Promise<ReactNode>;
  label: string;
  fallback?: ReactNode;
}) {
  return (
    <PanelBoundary label={label}>
      <Suspense
        fallback={
          fallback ?? (
            <div className="stack" role="status" aria-label={`Loading ${label.toLowerCase()}`}>
              <Skeleton />
              <span className="sr-only">Loading {label.toLowerCase()}…</span>
            </div>
          )
        }
      >
        <SafeTicketPanel load={load} label={label} />
      </Suspense>
    </PanelBoundary>
  );
}
