import { PageLoading } from '@/components/ui/page-loading';

/** This boundary also covers async layouts, before workspace identity is available. */
export default function Loading() {
  return (
    <main id="main-content">
      <PageLoading title="FixxFlow" message="Loading your workspace…" />
    </main>
  );
}
