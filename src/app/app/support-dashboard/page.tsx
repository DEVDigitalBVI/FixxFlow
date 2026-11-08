import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RetryButton } from '@/components/ui/retry-button';
import { TodayMetrics } from '@/features/reporting/components';
import { DashboardInsights } from '@/features/reporting/dashboard-insights';
import { requireInsightAccess } from '@/features/support-viewer/access';
import { isDashboard } from '@/features/support-viewer/model';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

export default async function SupportDashboardPage() {
  const viewer = await requireViewer();
  const access = await requireInsightAccess(viewer, 'dashboard');
  const db = await createClient();
  const { data, error } = await db.rpc('support_viewer_dashboard', { org: viewer.organizationId });
  if (error?.code === '42501') notFound();
  return (
    <div className="page overview-page">
      <PageHeader
        title={viewer.role === 'end_user' ? 'Support dashboard' : 'Employee dashboard preview'}
        eyebrow={viewer.organizationName}
        description="A read-only view of IT support activity across your workspace."
        actions={
          access.sharedIncidents ? (
            <Link className={buttonVariants({ variant: 'secondary' })} href="/app/shared-incidents">
              Shared incidents
            </Link>
          ) : undefined
        }
      />
      <p>
        <Badge tone="neutral">
          {viewer.role === 'end_user' ? 'View only' : 'Staff preview · View only'}
        </Badge>
      </p>
      {error || !isDashboard(data) ? (
        <Alert tone="error" role="alert">
          <p>Support statistics could not load. Try again.</p>
          <RetryButton />
        </Alert>
      ) : (
        <>
          <TodayMetrics report={data.report} personal title="Support across your organization" />
          <details className="progressive-section support-workload-details">
            <summary>IT workload and response details</summary>
            <DashboardInsights
              report={data.report}
              workload={data.workload.map((row, index) => ({
                ...row,
                user_id: `summary-${index}`,
              }))}
              showReports={false}
            />
          </details>
        </>
      )}
    </div>
  );
}
