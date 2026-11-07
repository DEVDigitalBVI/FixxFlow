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
        description="Published updates from ticket coordination. Shared incidents contain curated issue summaries; email announcements are separate company messages."
        back={{ href: '/app', label: 'Back to dashboard' }}
      />
      <ServiceAnnouncements full page={page} />
    </div>
  );
}
