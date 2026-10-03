import { reportServerError } from "@/lib/server-errors";
import { requireViewer } from '@/lib/auth/viewer';
import { getReport } from '@/features/reporting/data';
import { exportFilename, exportFormats, isExportFormat } from '@/features/reporting/export-model';
import { createReportCsv, createReportWorkbook } from '@/features/reporting/export-spreadsheet';
import { createReportPdf, PdfCharacterError } from '@/features/reporting/export-pdf';

export const runtime = 'nodejs';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
function failure(message: string, status: number, reference?: string) { return Response.json({ error: message, ...(reference ? { reference } : {}) }, { status, headers: { ...privateHeaders, ...(reference ? { 'X-Correlation-ID': reference } : {}) } }); }

export async function GET(request: Request) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return failure('Report downloads are available to support staff only.', 403);
  const format = new URL(request.url).searchParams.get('format');
  if (!isExportFormat(format)) return failure('Choose Excel, CSV, or PDF.', 400);
  try {
    const report = await getReport(viewer.organizationId, { throwOnError: true });
    if (!report) return failure('Reporting is temporarily unavailable. Please try again.', 503, reportServerError('report.export'));
    const bytes = format === 'csv' ? new TextEncoder().encode(createReportCsv(report, viewer.organizationName))
      : format === 'xlsx' ? createReportWorkbook(report, viewer.organizationName)
        : await createReportPdf(report, viewer.organizationName);
    return new Response(new Uint8Array(bytes), { headers: {
      ...privateHeaders,
      'Content-Type': `${exportFormats[format].mime}${format === 'csv' ? '; charset=utf-8' : ''}`,
      'Content-Disposition': `attachment; filename="${exportFilename(report, format)}"`,
    } });
  } catch (error) {
    if (error instanceof PdfCharacterError) return failure(error.message, 422);
    return failure('The report could not be downloaded. Please try again.', 500, reportServerError('report.export', error));
  }
}
