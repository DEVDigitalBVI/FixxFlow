import {
  createOrganizationCsv,
  createOrganizationPdf,
  createOrganizationWorkbook,
} from '@/features/platform/organization-export';
import {
  isOrganizationExport,
  organizationExportFilename,
} from '@/features/platform/organization-export-model';
import { exportFormats, isExportFormat } from '@/features/reporting/export-model';
import { PdfCharacterError } from '@/features/reporting/export-pdf';
import { requirePlatformOwner } from '@/lib/auth/platform';
import { normalizeSearch } from '@/lib/search';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const failure = (error: string, status: number, reference?: string) =>
  Response.json(
    { error, ...(reference ? { reference } : {}) },
    { status, headers: { ...headers, ...(reference ? { 'X-Correlation-ID': reference } : {}) } },
  );

export async function GET(request: Request) {
  // Redirects to sign-in or MFA verification when the owner session is not ready.
  await requirePlatformOwner();
  const query = new URL(request.url).searchParams,
    format = query.get('format');
  if (!isExportFormat(format)) return failure('Choose Excel, CSV, or PDF.', 400);
  try {
    const db = await createClient();
    const { data, error } = await db.rpc('platform_organization_export', {
      search_text: normalizeSearch(query.get('q') ?? ''),
      export_format: format,
    });
    if (error) throw error;
    if (!isOrganizationExport(data))
      return failure('The export returned unexpected data. Please try again.', 502);
    const bytes =
      format === 'csv'
        ? new TextEncoder().encode(createOrganizationCsv(data))
        : format === 'xlsx'
          ? createOrganizationWorkbook(data)
          : await createOrganizationPdf(data);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        'Content-Type': `${exportFormats[format].mime}${format === 'csv' ? '; charset=utf-8' : ''}`,
        'Content-Disposition': `attachment; filename="${organizationExportFilename(data.generatedAt, format)}"`,
      },
    });
  } catch (error) {
    if (error instanceof PdfCharacterError)
      return failure(
        'Some organization names contain characters this PDF font cannot display. Choose Excel or CSV to download the complete export.',
        422,
      );
    const reference = reportServerError('platform.organization.export', error);
    return failure(
      'The organization export could not be downloaded. Please try again.',
      500,
      reference,
    );
  }
}
