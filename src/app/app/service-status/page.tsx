import Link from 'next/link';

import { PageHeader } from '@/components/ui/page-header';
import { ServiceAnnouncements } from '@/features/portal/service-announcements';

export default async function ServiceStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams,
    requested = Number(params.page ?? 1),
    page = Number.isSafeInteger(requested) && requested > 0 && requested <= 10000 ? requested : 1;
  return (
    <div className="page page-narrow">
      <PageHeader
        title="Service announcements"
        description="Updates from your IT team about known issues."
      />
      <ServiceAnnouncements full page={page} />
      <Link href="/app">Back to home</Link>
    </div>
  );
}
