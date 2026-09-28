import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { load } from '../../../tests/helpers/load-module.mjs';
import { report, organization } from '../../../tests/fixtures/report-export.mjs';

const { createReportCsv, createReportWorkbook } = load('src/features/reporting/export-spreadsheet.ts', { 'server-only': {} });
const { createReportPdf, PdfCharacterError } = load('src/features/reporting/export-pdf.ts', { 'server-only': {}, '@pdf-lib/fontkit': { default: fontkit } });
const { isExportFormat } = load('src/features/reporting/export-model.ts');

test('only the three supported export formats are accepted', () => {
  for (const format of ['xlsx', 'csv', 'pdf']) assert.equal(isExportFormat(format), true);
  for (const format of [null, '', 'constructor', '__proto__', 'PDF', 'html']) assert.equal(isExportFormat(format), false);
});

test('CSV roundtrips every daily and breakdown row, Unicode, quotes and newlines with exact numbers', () => {
  const csv = createReportCsv(report, organization);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const workbook = XLSX.read(Buffer.from(csv), { type: 'buffer', raw: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
  assert.equal(rows.filter(row => row.Section === 'Daily activity').length, 150);
  assert.equal(rows.filter(row => row.Section === 'Breakdowns').length, report.breakdowns.length);
  assert.equal(rows.find(row => row.Group.includes('Café')).Group, report.breakdowns[13].label);
  assert.ok(rows.every(row => row.Organization === organization && row.Timezone === report.timezone));
  assert.ok(rows.every(row => row['Period start'] === '2026-08-29' && row['Period end'] === report.today));
  const response = rows.filter(row => row.Section === 'Daily activity' && row.Metric === 'Average response');
  assert.equal(response[0].Value, ''); assert.match(response[0].Notes, /No data/);
  assert.equal(response[1].Value, '0'); assert.equal(response[2].Value, '12.345');
  assert.equal(rows.find(row => row.Section === 'SLA' && row.Metric === 'Compliance' && row.Group === 'Resolution').Value, '');
});

test('CSV neutralizes spreadsheet formulas while Excel stores the original label as text', () => {
  for (const label of ['=HYPERLINK("https://example.test")', '  +1+1', '-2+3', '@SUM(A1)', '\tformula', '\rformula']) {
    const sample = { ...report, breakdowns: [{ kind: 'categories', label, value: 1 }] };
    const csv = XLSX.read(Buffer.from(createReportCsv(sample, label)), { type: 'buffer', raw: true });
    const rows = XLSX.utils.sheet_to_json(csv.Sheets[csv.SheetNames[0]]);
    assert.equal(rows[0].Organization, `'${label}`);
    assert.equal(rows.find(row => row.Section === 'Breakdowns').Group, `'${label}`);
    const xlsx = XLSX.read(createReportWorkbook(sample, label), { type: 'buffer' });
    assert.equal(xlsx.Sheets.Breakdowns.B2.t, 's');
    assert.equal(xlsx.Sheets.Breakdowns.B2.v, label);
    assert.equal(xlsx.Sheets.Breakdowns.B2.f, undefined);
  }
});

test('Excel contains sortable dates, typed exact numbers, percentages, filters and all detailed rows', () => {
  const workbook = XLSX.read(createReportWorkbook(report, organization), { type: 'buffer', cellNF: true });
  assert.deepEqual(workbook.SheetNames, ['Overview', 'Daily activity', 'Breakdowns', 'SLA']);
  const daily = workbook.Sheets['Daily activity'];
  assert.equal(daily['!ref'], 'A1:F31'); assert.equal(daily['!autofilter'].ref, 'A1:F31');
  assert.equal(daily.A2.t, 'n'); assert.equal(daily.A2.z, 'yyyy-mm-dd');
  assert.equal(XLSX.SSF.format(daily.A2.z, daily.A2.v), '2026-08-29');
  assert.equal(daily.E2, undefined); assert.equal(daily.E3.v, 0); assert.equal(daily.E4.v, 12.345);
  assert.equal(workbook.Sheets.SLA.D2.v, 20 / 21); assert.equal(workbook.Sheets.SLA.D2.z, '0.0%');
  assert.equal(workbook.Sheets.SLA.D3, undefined);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Breakdowns).length, report.breakdowns.length);
  assert.equal(workbook.Sheets.Overview.B2.v, organization);
});

test('PDF is a readable multipage document with embedded fonts and metadata', async () => {
  const bytes = await createReportPdf(report, organization);
  assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 3);
  assert.equal(document.getTitle(), 'FixxFlow operational report');
  assert.equal(document.getSubject(), organization);
  assert.ok(document.getPages().every(page => page.getWidth() === 595.28 && page.getHeight() === 841.89));
});

test('PDF paginates an oversized name and empty reports and reports unsupported glyphs without silently losing text', async () => {
  const bytes = await createReportPdf({ ...report, daily: [], sla: [], breakdowns: [{ kind: 'workload', label: 'LongName'.repeat(800), value: 1 }] }, organization);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 4);
  await assert.rejects(createReportPdf(report, '東京'), PdfCharacterError);
});

function route({ role = 'technician', result = report, authError, dataError, pdfError } = {}) {
  const calls = [];
  const { GET } = load('src/app/app/reports/export/route.ts', {
    '@/lib/auth/viewer': { requireViewer: async () => { if (authError) throw authError; return { role, organizationId: 'verified-org', organizationName: organization }; } },
    '@/features/reporting/data': { getReport: async id => { calls.push(id); if (dataError) throw dataError; return result; } },
    '@/features/reporting/export-spreadsheet': { createReportCsv: () => 'csv', createReportWorkbook: () => new Uint8Array([1, 2]) },
    '@/features/reporting/export-pdf': { PdfCharacterError, createReportPdf: async () => { if (pdfError) throw pdfError; return new Uint8Array([3, 4]); } },
  });
  return { calls, GET: format => GET(new Request(`https://example.test/app/reports/export?format=${format}&organizationId=attacker-org`)) };
}

test('downloads use only verified organization membership and private attachments for all formats', async () => {
  for (const format of ['csv', 'xlsx', 'pdf']) {
    const r = route(); const response = await r.GET(format);
    assert.equal(response.status, 200); assert.deepEqual(r.calls, ['verified-org']);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="fixxflow-report-2026-09-27.${format}"`);
    assert.match(response.headers.get('Content-Type'), format === 'xlsx' ? /spreadsheetml/ : new RegExp(format));
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
});

test('export authorization, invalid formats and unavailable data fail without leaking attachments', async () => {
  const employee = route({ role: 'end_user' }); assert.equal((await employee.GET('pdf')).status, 403); assert.deepEqual(employee.calls, []);
  const invalid = route(); assert.equal((await invalid.GET('constructor')).status, 400); assert.deepEqual(invalid.calls, []);
  const redirect = new Error('NEXT_REDIRECT'); await assert.rejects(route({ authError: redirect }).GET('csv'), error => error === redirect);
  for (const [options, status] of [[{ result: null }, 503], [{ dataError: new Error('database-secret') }, 500], [{ pdfError: new PdfCharacterError() }, 422]]) {
    const response = await route(options).GET('pdf');
    assert.equal(response.status, status); assert.equal(response.headers.get('Content-Disposition'), null);
    assert.doesNotMatch(await response.text(), /database-secret/);
  }
});
