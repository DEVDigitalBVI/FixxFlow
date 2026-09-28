import { exportFormats, type ExportFormat } from './export-model';

export async function fetchReportDownload(format: ExportFormat, signal: AbortSignal) {
  const response = await fetch(`/app/reports/export?format=${format}`, { cache: 'no-store', credentials: 'same-origin', signal });
  if (response.redirected || response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('Your session may have expired. Reload Reports, sign in if prompted, and try again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : 'The report could not be downloaded. Please try again.');
  }
  if (response.headers.get('content-type')?.split(';')[0] !== exportFormats[format].mime) {
    throw new Error('The report returned an unexpected file. Please try again.');
  }
  const filename = response.headers.get('content-disposition')?.match(/filename="(fixxflow-report-[0-9-]+\.(?:xlsx|csv|pdf))"/)?.[1] ?? `fixxflow-report.${format}`;
  return { blob: await response.blob(), filename };
}
