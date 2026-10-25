import assert from 'node:assert/strict';
import test from 'node:test';

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';

import { load } from '../../../tests/helpers/load-module.mjs';

const {
  defaultReportDefinition,
  definitionFromInput,
  definitionToQuery,
  formatCustomValue,
  isCustomReport,
  isCustomReportDefinition,
} = load('src/features/reporting/custom-model.ts');

const definition = {
  ...defaultReportDefinition('2026-10-13'),
  filters: {
    statuses: ['open'],
    priorities: ['high'],
    categoryIds: ['50000000-0000-0000-0000-000000000401'],
    subcategoryIds: [],
    teamIds: [],
    technicianIds: [],
    departmentIds: [],
    locationIds: [],
  },
};
const report = {
  asOf: '2026-10-13T12:00:00Z',
  timezone: 'America/Tortola',
  startDate: '2026-09-14',
  endDate: '2026-10-13',
  reportType: 'volume',
  groupBy: 'time',
  interval: 'day',
  metrics: [
    { key: 'created', label: 'Created', unit: 'tickets', description: 'Created tickets.' },
    { key: 'resolved', label: 'Resolved', unit: 'tickets', description: 'Resolved tickets.' },
  ],
  summary: [
    { key: 'created', label: 'Created', unit: 'tickets', value: 3, samples: 3 },
    { key: 'resolved', label: 'Resolved', unit: 'tickets', value: 1, samples: 1 },
  ],
  rows: [
    {
      key: '2026-10-12',
      label: '2026-10-12',
      values: { created: 2, resolved: 0 },
      samples: { created: 2, resolved: 0 },
    },
    {
      key: '2026-10-13',
      label: '2026-10-13',
      values: { created: 1, resolved: 1 },
      samples: { created: 1, resolved: 1 },
    },
  ],
};

test('custom definitions roundtrip URL fields and reject unsafe or incompatible combinations', () => {
  const query = definitionToQuery(definition),
    parsed = definitionFromInput(query, defaultReportDefinition('2026-10-13'));
  assert.deepEqual(parsed, definition);
  assert.equal(isCustomReportDefinition(parsed), true);
  const mismatched = new URLSearchParams(query);
  mismatched.set('reportType', 'sla');
  assert.equal(definitionFromInput(mismatched, definition), null);
  const long = { ...definition, startDate: '2024-01-01' };
  assert.equal(isCustomReportDefinition(long), false);
  assert.equal(
    isCustomReportDefinition({
      ...definition,
      filters: { ...definition.filters, categoryIds: ['not-a-uuid'] },
    }),
    false,
  );
});
test('template navigation gives each definition a fresh stateful builder', () => {
  const { CustomReportBuilder } = load('src/features/reporting/custom-builder.tsx', {
    '@/features/tickets/presentation': { ticketStatuses: {}, ticketPriorities: {} },
  });
  const references = {
    categories: [],
    subcategories: [],
    teams: [],
    technicians: [],
    departments: [],
    locations: [],
  };
  const volume = CustomReportBuilder({
    definition: defaultReportDefinition('2026-10-13', 'volume'),
    references,
  });
  const backlog = CustomReportBuilder({
    definition: defaultReportDefinition('2026-10-13', 'backlog'),
    references,
  });
  assert.ok(volume.key);
  assert.ok(backlog.key);
  assert.notEqual(volume.key, backlog.key);
});
test('custom payload validation and formatting preserve zero, no-data, percentages and elapsed time', () => {
  assert.equal(isCustomReport(report), true);
  assert.equal(
    isCustomReport({ ...report, rows: [{ ...report.rows[0], values: { created: '3' } }] }),
    false,
  );
  assert.equal(formatCustomValue(null, 'minutes'), 'No data');
  assert.equal(formatCustomValue(0, 'minutes'), '<1m');
  assert.equal(formatCustomValue(90, 'minutes'), '1.5h');
  assert.equal(formatCustomValue(99.95, 'percent'), '100.0%');
});
test('custom results expose summaries, chart context and a keyboard-scrollable exact table', () => {
  const { CustomReportResults } = load('src/features/reporting/custom-components.tsx', {
    'next/link': { default: (props) => React.createElement('a', props) },
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children }) => React.createElement('button', null, children),
    },
    './components': {
      Trend: (props) => React.createElement('section', { 'aria-label': props.title }, 'Trend'),
      Bars: (props) => React.createElement('section', { 'aria-label': props.title }, 'Bars'),
    },
    '@/app/app/reports/actions': {},
    './custom-download': { CustomReportDownload: () => null },
  });
  const html = renderToStaticMarkup(React.createElement(CustomReportResults, { report }));
  assert.match(html, /Report results/);
  assert.match(html, /3 tickets measured/);
  assert.match(html, /aria-label="Ticket volume trend"/);
  assert.match(html, /role="region" aria-label="Custom report exact data" tabindex="0"/);
  assert.match(html, /<caption>Ticket volume grouped by time<\/caption>/);
  assert.match(html, /<th scope="row"/);
  assert.match(html, />0<\/td>/);
});
test('shared reports can be customized as a personal copy without exposing owner actions', () => {
  const { SavedReportActions } = load('src/features/reporting/custom-components.tsx', {
    'next/link': { default: (props) => React.createElement('a', props) },
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children }) => React.createElement('button', null, children),
    },
    './components': { Trend: () => null, Bars: () => null },
    '@/app/app/reports/actions': {},
    './custom-download': { CustomReportDownload: () => null },
  });
  const saved = {
    id: '60000000-0000-0000-0000-000000000001',
    owner_id: 'owner',
    name: 'Shared health',
    description: null,
    visibility: 'shared',
    definition,
    created_at: report.asOf,
    updated_at: report.asOf,
  };
  const copy = renderToStaticMarkup(
    React.createElement(SavedReportActions, { report: saved, canEdit: false }),
  );
  assert.match(copy, /Customize a copy/);
  assert.doesNotMatch(copy, /saved=/);
  assert.doesNotMatch(copy, /Delete report/);
  const owner = renderToStaticMarkup(
    React.createElement(SavedReportActions, { report: saved, canEdit: true }),
  );
  assert.match(owner, /Edit definition/);
  assert.match(owner, /saved=60000000/);
  assert.match(owner, /Delete report/);
});
test('custom CSV, Excel and PDF include metadata and every exact result row', async () => {
  const exports = load('src/features/reporting/custom-export.ts', {
    'server-only': {},
    '@pdf-lib/fontkit': { default: fontkit },
  });
  const csv = exports.createCustomReportCsv(report, 'Acme', '=Quarterly report');
  const csvBook = XLSX.read(Buffer.from(csv), { type: 'buffer', raw: true });
  const csvRows = XLSX.utils.sheet_to_json(csvBook.Sheets[csvBook.SheetNames[0]], {
    header: 1,
    defval: '',
  });
  assert.equal(csvRows.at(-1)[0], '2026-10-13');
  assert.equal(csvRows[1][1], 'Acme');
  assert.equal(csvRows[0][1], "'=Quarterly report");
  const workbook = XLSX.read(
    exports.createCustomReportWorkbook(report, 'Acme', 'Quarterly report'),
    { type: 'buffer' },
  );
  assert.deepEqual(workbook.SheetNames, ['Overview', 'Report data']);
  assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['Report data']).length, report.rows.length);
  const pdf = await PDFDocument.load(
    await exports.createCustomReportPdf(report, 'Acme', 'Quarterly report'),
  );
  assert.ok(pdf.getPageCount() >= 2);
  assert.match(pdf.getTitle(), /Quarterly report/);
});
test('scheduled report email uses a recipient-scoped idempotency key and a typed attachment', async () => {
  let request;
  const { sendScheduledReportEmail } = load('src/features/reporting/scheduled-email.ts', {
    'server-only': {},
  });
  const id = await sendScheduledReportEmail({
    deliveryId: 'delivery-id',
    reportId: 'report-id',
    reportName: 'Weekly service health',
    recipient: 'owner@example.test',
    filename: 'report.csv',
    bytes: new TextEncoder().encode('hello'),
    mime: 'text/csv',
    config: {
      apiKey: 'key',
      from: 'FixxFlow <reports@example.test>',
      siteUrl: 'https://app.example.test',
    },
    request: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return Response.json({ id: 'provider-id' });
    },
  });
  assert.equal(id, 'provider-id');
  assert.equal(request.options.headers['Idempotency-Key'], 'scheduled-report/delivery-id');
  assert.deepEqual(request.body.to, ['owner@example.test']);
  assert.equal(request.body.attachments[0].filename, 'report.csv');
  assert.equal(request.body.attachments[0].content, Buffer.from('hello').toString('base64'));
  assert.doesNotMatch(JSON.stringify(request.body), /key/);
});
test('scheduled report cron authenticates, renders a claimed item and fences its acknowledgement', async (t) => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-secret';
  t.after(() => {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });
  const calls = [];
  const database = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'enqueue_scheduled_report_deliveries') return { data: 1, error: null };
      if (name === 'claim_report_deliveries')
        return {
          data: [
            {
              delivery_id: 'delivery',
              lease_token: 'lease',
              organization_id: 'org',
              report_id: 'saved',
              report_name: 'Weekly',
              definition,
              recipient_email: 'owner@example.test',
              format: 'csv',
              scheduled_for: report.asOf,
              attempts: 1,
            },
          ],
          error: null,
        };
      if (name === 'custom_report') return { data: report, error: null };
      if (name === 'finish_report_delivery') return { data: true, error: null };
      throw Error(name);
    },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { name: 'Acme' }, error: null }) }),
      }),
    }),
  };
  const { GET } = load('src/app/api/cron/reports/route.ts', {
    '@/lib/supabase/admin': { createAdminClient: () => database },
    '@/features/notifications/configuration': {
      getNotificationEmailConfiguration: () => ({
        apiKey: 'key',
        from: 'reports@example.test',
        siteUrl: 'https://app.example.test',
      }),
    },
    '@/lib/server-errors': { reportServerError: () => 'reference' },
    '@/features/reporting/custom-model': { isCustomReport: (value) => value === report },
    '@/features/reporting/custom-export': {
      createCustomReportCsv: () => 'csv',
      createCustomReportWorkbook: () => new Uint8Array([1]),
      createCustomReportPdf: async () => new Uint8Array([2]),
    },
    '@/features/reporting/export-model': {
      exportFormats: { csv: { mime: 'text/csv' }, xlsx: { mime: 'xlsx' }, pdf: { mime: 'pdf' } },
    },
    '@/features/reporting/scheduled-email': {
      sendScheduledReportEmail: async (options) => {
        calls.push(['send', options]);
        return 'provider';
      },
    },
  });
  assert.equal((await GET(new Request('https://example.test/api/cron/reports'))).status, 401);
  const response = await GET(
    new Request('https://example.test/api/cron/reports', {
      headers: { authorization: 'Bearer cron-secret' },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { queued: 1, processed: 1, sent: 1, failed: 0 });
  assert.ok(calls.some((call) => call[0] === 'send' && call[1].recipient === 'owner@example.test'));
  const finish = calls.find((call) => call[0] === 'finish_report_delivery');
  assert.equal(finish[1].target_id, 'delivery');
  assert.equal(finish[1].token, 'lease');
});

test('custom creation waits for a chosen definition before querying results', async () => {
  let runs = 0;
  const Page = load('src/app/app/reports/custom/page.tsx', {
    'next/link': { default: (props) => React.createElement('a', props) },
    'next/navigation': {
      notFound() {
        throw Error('NOT_FOUND');
      },
    },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({
        id: 'staff',
        role: 'technician',
        organizationId: 'org',
        organizationTimezone: 'UTC',
      }),
    },
    '@/features/reporting/custom-data': {
      getSavedReport: async () => null,
      getReportReferences: async () => ({}),
      getCustomReport: async () => {
        runs++;
        return null;
      },
    },
    '@/features/reporting/custom-builder': {
      CustomReportBuilder: () => React.createElement('form', null, 'Builder'),
    },
    '@/features/reporting/custom-components': {
      CustomReportResults: () => null,
      ReportOutputActions: () => null,
      SaveReportPanel: () => null,
    },
  }).default;
  const start = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
  assert.equal(runs, 0);
  assert.match(start, /Start with a template/);
  assert.doesNotMatch(start, /custom report could not load/);
  const run = renderToStaticMarkup(
    await Page({ searchParams: Promise.resolve({ reportType: 'volume' }) }),
  );
  assert.equal(runs, 1);
  assert.doesNotMatch(run, /Start with a template/);
  assert.match(run, /Your definition is preserved/);
});

test('report entity filters use individually labeled choices and retain selected values', () => {
  const { CustomReportBuilder } = load('src/features/reporting/custom-builder.tsx');
  const references = {
    categories: [{ id: definition.filters.categoryIds[0], name: 'Network' }],
    subcategories: [],
    teams: [],
    technicians: [],
    departments: [],
    locations: [],
  };
  const html = renderToStaticMarkup(
    React.createElement(CustomReportBuilder, { definition, references }),
  );
  assert.doesNotMatch(html, /<select[^>]*multiple/);
  assert.match(
    html,
    /<input(?=[^>]*type="checkbox")(?=[^>]*name="categoryIds")(?=[^>]*checked="")[^>]*\/>Network/,
  );
});

test('scheduled report failures identify the failing phase regardless of error wording', async (t) => {
  const originalSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret';
  t.after(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });
  for (const phase of ['render_failed', 'provider_failed']) {
    let acknowledged;
    const database = {
      rpc: async (name, args) => {
        if (name === 'enqueue_scheduled_report_deliveries') return { data: 1 };
        if (name === 'claim_report_deliveries')
          return {
            data: [
              {
                delivery_id: 'delivery',
                lease_token: 'lease',
                organization_id: 'org',
                report_id: 'report',
                report_name: 'Weekly',
                definition,
                recipient_email: 'owner@example.test',
                format: 'csv',
              },
            ],
          };
        if (name === 'custom_report') return { data: report };
        if (name === 'finish_report_delivery') {
          acknowledged = args;
          return { data: true };
        }
        throw Error(name);
      },
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Acme' } }) }) }),
      }),
    };
    const { GET } = load('src/app/api/cron/reports/route.ts', {
      '@/lib/supabase/admin': { createAdminClient: () => database },
      '@/features/notifications/configuration': { getNotificationEmailConfiguration: () => ({}) },
      '@/lib/server-errors': { reportServerError: () => 'reference' },
      '@/features/reporting/custom-model': { isCustomReport: () => true },
      '@/features/reporting/custom-export': {
        createCustomReportCsv: () => {
          if (phase === 'render_failed') throw Error('Missing provider display label');
          return 'csv';
        },
      },
      '@/features/reporting/scheduled-email': {
        sendScheduledReportEmail: async () => {
          throw Error('Connection reset');
        },
      },
    });
    const response = await GET(
      new Request('https://example.test/api/cron/reports', {
        headers: { authorization: 'Bearer test-secret' },
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { queued: 1, processed: 1, sent: 0, failed: 1 });
    assert.equal(acknowledged.failure_code, phase);
    assert.equal(acknowledged.provider_id, null);
    assert.equal(acknowledged.token, 'lease');
  }
});
