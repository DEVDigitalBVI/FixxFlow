import { getNotificationEmailConfiguration } from '@/features/notifications/configuration';
import {
  createCustomReportCsv,
  createCustomReportPdf,
  createCustomReportWorkbook,
} from '@/features/reporting/custom-export';
import { isCustomReport, type CustomReport } from '@/features/reporting/custom-model';
import { exportFormats } from '@/features/reporting/export-model';
import { sendScheduledReportEmail } from '@/features/reporting/scheduled-email';
import { isCronAuthorized } from '@/lib/cron-auth';
import { reportServerError } from '@/lib/server-errors';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/types/database';

export const runtime = 'nodejs';
export const maxDuration = 60;
function filename(name: string, end: string, format: 'xlsx' | 'csv' | 'pdf') {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'report';
  return `fixxflow-custom-report-${slug}-${end}.${format}`;
}
async function render(
  report: CustomReport,
  organization: string,
  name: string,
  format: 'xlsx' | 'csv' | 'pdf',
) {
  return format === 'csv'
    ? new TextEncoder().encode(createCustomReportCsv(report, organization, name))
    : format === 'xlsx'
      ? createCustomReportWorkbook(report, organization, name)
      : createCustomReportPdf(report, organization, name);
}
type DatabaseClient = ReturnType<typeof createAdminClient>;
type Delivery =
  import('@/types/database').Database['public']['Functions']['claim_report_deliveries']['Returns'][number];
type EmailConfiguration = NonNullable<ReturnType<typeof getNotificationEmailConfiguration>>;

async function deliver(database: DatabaseClient, item: Delivery, config: EmailConfiguration) {
  let phase: 'render_failed' | 'provider_failed' = 'render_failed';
  let report: CustomReport | undefined;
  let providerId: string | undefined;
  let failure: string | undefined;
  try {
    const [organization, result] = await Promise.all([
      database.from('organizations').select('name').eq('id', item.organization_id).single(),
      database.rpc('custom_report', {
        target_organization_id: item.organization_id,
        report_config: item.definition as Json,
      }),
    ]);
    if (organization.error || result.error || !isCustomReport(result.data))
      throw organization.error ?? result.error ?? new Error('Invalid scheduled report payload');
    report = result.data;
    const bytes = await render(report, organization.data.name, item.report_name, item.format);
    phase = 'provider_failed';
    providerId = await sendScheduledReportEmail({
      deliveryId: item.delivery_id,
      reportId: item.report_id,
      reportName: item.report_name,
      recipient: item.recipient_email,
      filename: filename(item.report_name, report.endDate, item.format),
      bytes,
      mime: exportFormats[item.format].mime,
      config,
    });
  } catch (error) {
    failure = phase;
    reportServerError('report.schedule.delivery', error);
  }
  const finished = await database.rpc('finish_report_delivery', {
    target_id: item.delivery_id,
    token: item.lease_token,
    provider_id: providerId ?? null,
    failure_code: failure ?? null,
    snapshot: report?.asOf ?? null,
    report_summary: report ? { ...report.summary } : null,
  });
  if (finished.error || !finished.data)
    throw finished.error ?? new Error('Report delivery acknowledgement failed');
  return Boolean(providerId);
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const emailConfig = getNotificationEmailConfiguration(process.env);
  if (!emailConfig)
    return Response.json({ error: 'Email delivery is not configured' }, { status: 503 });
  try {
    const database = createAdminClient();
    const queued = await database.rpc('enqueue_scheduled_report_deliveries');
    if (queued.error) throw queued.error;
    const claimed = await database.rpc('claim_report_deliveries', {
      batch_size: 3,
      lease_seconds: 240,
    });
    if (claimed.error) throw claimed.error;
    let sent = 0;
    for (const item of claimed.data ?? []) if (await deliver(database, item, emailConfig)) sent++;
    const processed = claimed.data?.length ?? 0;
    return Response.json({ queued: queued.data ?? 0, processed, sent, failed: processed - sent });
  } catch (error) {
    const reference = reportServerError('report.schedule.dispatch', error);
    return Response.json(
      { error: 'Scheduled report processing failed', reference },
      { status: 500, headers: { 'X-Correlation-ID': reference } },
    );
  }
}
