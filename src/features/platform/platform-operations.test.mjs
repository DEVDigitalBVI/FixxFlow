import assert from 'node:assert/strict';
import test from 'node:test';

import fontkit from '@pdf-lib/fontkit';
import * as XLSX from 'xlsx';

import { load } from '../../../tests/helpers/load-module.mjs';

const model = load('src/features/platform/organization-export-model.ts');
const files = load('src/features/platform/organization-export.ts', {
  '@pdf-lib/fontkit': { default: fontkit },
});
const retention = load('src/features/platform/retention-model.ts');

const row = (overrides = {}) => ({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Acme Corp',
  slug: 'acme',
  timezone: 'America/New_York',
  created_at: '2026-01-02T03:04:05.000Z',
  administrators: 1,
  technicians: 2,
  employees: 30,
  inactive_members: 4,
  tickets_total: 120,
  tickets_open: 9,
  tickets_last_30_days: 15,
  chats_total: 40,
  assets_total: 55,
  last_ticket_activity_at: '2026-10-26T10:00:00.000Z',
  ...overrides,
});
const data = (rows, extra = {}) => ({
  generatedAt: '2026-10-27T12:00:00.000Z',
  search: '',
  matchingCount: rows.length,
  organizations: rows,
  ...extra,
});

test('organization export payloads are validated and scoped in plain language', () => {
  assert.equal(model.isOrganizationExport(data([row()])), true);
  assert.equal(model.isOrganizationExport(data([row({ tickets_open: '9' })])), false);
  assert.equal(model.isOrganizationExport(data([row({ last_ticket_activity_at: null })])), true);
  assert.equal(model.exportScope(data([row()])), 'All organizations · 1 organization');
  assert.equal(
    model.exportScope(data([row(), row()], { search: 'acme', matchingCount: 6000 })),
    'Organizations matching “acme” · first 2 of 6,000, oldest first',
  );
  assert.equal(
    model.organizationExportFilename('2026-10-27T12:00:00.000Z', 'csv'),
    'fixxflow-organizations-2026-10-27.csv',
  );
});

test('CSV and Excel exports carry every column and neutralize spreadsheet formulas', () => {
  const csv = files.createOrganizationCsv(
    data([row({ name: '=HYPERLINK("x")', last_ticket_activity_at: null })]),
  );
  assert.ok(csv.startsWith('﻿'));
  assert.match(csv, /"Note","Account metadata and aggregate counts only/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"Active employees"/);
  assert.match(csv, /"None"\r\n$/);

  const workbook = XLSX.read(files.createOrganizationWorkbook(data([row()])));
  assert.deepEqual(workbook.SheetNames, ['Overview', 'Organizations']);
  const sheet = XLSX.utils.sheet_to_json(workbook.Sheets.Organizations, { header: 1 });
  assert.equal(sheet[0].length, model.organizationColumns.length);
  assert.deepEqual(sheet[1].slice(0, 5), [
    'Acme Corp',
    'acme',
    'America/New_York',
    '2026-01-02',
    1,
  ]);
});

test('PDF export paginates long lists and refuses unsupported characters clearly', async () => {
  const many = Array.from({ length: 80 }, (_, i) => row({ name: `Organization ${i + 1}` }));
  const bytes = await files.createOrganizationPdf(data(many));
  const text = Buffer.from(bytes).subarray(0, 5).toString('latin1');
  assert.equal(text, '%PDF-');
  const { PDFDocument } = await import('pdf-lib');
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
  await assert.rejects(files.createOrganizationPdf(data([row({ name: 'Snow ☃︎ 🚀' })])), /PDF font/);
});

test('retention status and cleanup results are validated and summarized for owners', () => {
  const run = {
    trigger: 'schedule',
    startedAt: '2026-10-27T03:17:00Z',
    finishedAt: '2026-10-27T03:17:02Z',
    dedupDeleted: 1200,
    countsDeleted: 1,
    complete: true,
  };
  assert.equal(
    retention.isRetentionStatus({
      retentionDays: 365,
      expiredKeys: 0,
      expiredCounts: 0,
      lastRun: run,
    }),
    true,
  );
  assert.equal(
    retention.isRetentionStatus({
      retentionDays: 365,
      expiredKeys: -1,
      expiredCounts: 0,
      lastRun: null,
    }),
    false,
  );
  assert.equal(retention.runSummary(run), 'Scheduled run removed 1,200 keys and 1 daily count.');
  assert.equal(
    retention.cleanupMessage({
      skipped: false,
      dedupDeleted: 2,
      countsDeleted: 0,
      complete: false,
      finishedAt: run.finishedAt,
    }),
    'Removed 2 expired deduplication keys and 0 daily counts past retention. More expired rows remain; the next run continues automatically.',
  );
  assert.match(retention.cleanupMessage({ skipped: true }), /already running/);
  assert.equal(retention.isCleanupResult({ skipped: false }), false);
});

test('the analytics cleanup cron requires the cron secret and reports failures without details', async () => {
  const calls = [];
  let fail = false;
  const { GET } = load('src/app/api/cron/analytics-cleanup/route.ts', {
    '@/lib/cron-auth': {
      isCronAuthorized: (request) => request.headers.get('authorization') === 'Bearer secret',
    },
    '@/lib/server-errors': { reportServerError: () => 'reference' },
    '@/lib/supabase/admin': {
      createAdminClient: () => ({
        rpc: async (name, args) => {
          calls.push([name, args]);
          return fail
            ? { data: null, error: { code: 'XX000', message: 'secret detail' } }
            : { data: { skipped: false, dedupDeleted: 3 }, error: null };
        },
      }),
    },
  });
  const request = (auth) =>
    new Request('https://example.test/api/cron/analytics-cleanup', {
      headers: auth ? { authorization: auth } : {},
    });
  assert.equal((await GET(request())).status, 401);
  assert.equal(calls.length, 0);
  const ok = await GET(request('Bearer secret'));
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0], ['run_product_usage_cleanup', { row_limit: 50000 }]);
  fail = true;
  const failed = await GET(request('Bearer secret'));
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    error: 'Analytics cleanup could not run',
    reference: 'reference',
  });
});
