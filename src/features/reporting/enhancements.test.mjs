import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const mocks = {
  'next/link': { default: (p) => React.createElement('a', p) },
  '@/components/ui/retry-button': {
    RetryButton: () => React.createElement('button', null, 'Try again'),
  },
};
test('daily timing fields hide and disable irrelevant days while retaining labeled native controls', () => {
  let frequency = 'daily';
  const { ScheduleTimingFields } = load('src/features/reporting/schedule-fields.tsx', {
    react: {
      ...React,
      useState: () => [
        frequency,
        (value) => {
          frequency = value;
        },
      ],
    },
  });
  let html = render(React.createElement(ScheduleTimingFields));
  assert.match(html, /value="daily" selected/);
  assert.match(html, /<label class="field" hidden="">Day of week/);
  assert.match(html, /name="weekday" disabled/);
  assert.match(html, /<input(?=[^>]*name="monthday")(?=[^>]*disabled)[^>]*>/);
  assert.match(html, />Hour<select/);
  frequency = 'monthly';
  html = render(React.createElement(ScheduleTimingFields));
  assert.match(html, /<label class="field">Day of month/);
});
test('workload differentiates a real empty queue from failure and labels all count meanings', () => {
  const { WorkloadCard } = load('src/features/reporting/dashboard-insights.tsx', mocks);
  const html = render(
    React.createElement(WorkloadCard, {
      rows: [
        {
          user_id: 'tech',
          label: 'Jordan <IT>',
          active: false,
          open_count: 5,
          waiting_count: 2,
          overdue_count: 1,
        },
      ],
    }),
  );
  assert.match(html, /Jordan &lt;IT&gt;/);
  assert.match(html, /No longer active in IT/);
  assert.match(html, /data-label="Open">5/);
  assert.match(html, /data-label="Waiting">2/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /Top 5/);
  const empty = render(React.createElement(WorkloadCard, { rows: [] }));
  assert.match(empty, /No open tickets right now/);
  const failure = render(React.createElement(WorkloadCard, { rows: null }));
  assert.match(failure, /couldn’t load/);
  assert.doesNotMatch(failure, /No open tickets/);
  assert.match(failure, /Try again/);
});
test('dashboard response trends retain just fourteen reply days with null timing gaps and exact accessible data', () => {
  const { DashboardInsights } = load('src/features/reporting/dashboard-insights.tsx', mocks);
  const daily = Array.from({ length: 30 }, (_, i) => ({
    day: `2026-09-${String(i + 1).padStart(2, '0')}`,
    response: i === 29 ? 0 : null,
  }));
  const html = render(
    React.createElement(DashboardInsights, {
      report: { timezone: 'America/Tortola', daily },
      workload: [],
    }),
  );
  assert.match(html, /14 days/);
  assert.doesNotMatch(html, /2026-09-01/);
  assert.match(html, /2026-09-17/);
  assert.match(html, /No data/);
  assert.match(html, /&lt;1m/);
  assert.match(html, /role="img"/);
  assert.match(html, /elapsed/);
});
test('daily action uses workspace time, ignores irrelevant day inputs, and rejects invalid or incomplete schedules', async () => {
  let role = 'administrator';
  const inserts = [];
  const { saveReportSchedule } = load('src/app/app/reports/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({
        id: 'owner',
        role,
        organizationId: 'verified-org',
        organizationTimezone: 'America/Tortola',
      }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        from: (name) => ({
          insert: async (row) => {
            assert.equal(name, 'report_schedules');
            inserts.push(row);
            return { error: null };
          },
        }),
      }),
    },
  });
  const form = new FormData();
  form.set('reportId', '11111111-1111-4111-8111-111111111111');
  form.set('frequency', 'daily');
  form.set('runHour', '8');
  form.set('recipients', 'owner@example.invalid');
  form.set('weekday', 'bad');
  form.set('monthday', 'bad');
  assert.ok((await saveReportSchedule(form)).success);
  assert.equal(inserts[0].frequency, 'daily');
  assert.equal(inserts[0].weekday, null);
  assert.equal(inserts[0].monthday, null);
  assert.equal(inserts[0].timezone, 'America/Tortola');
  assert.equal(inserts[0].organization_id, 'verified-org');
  form.delete('runHour');
  assert.ok((await saveReportSchedule(form)).error);
  form.set('runHour', '8');
  form.set('frequency', 'hourly');
  assert.ok((await saveReportSchedule(form)).error);
  role = 'technician';
  form.set('frequency', 'daily');
  assert.ok((await saveReportSchedule(form)).error);
  assert.equal(inserts.length, 1);
});
test('workload loader remains organization scoped and bounded and returns unavailable for RPC or connection errors', async () => {
  let fail = false;
  const calls = [];
  const { getDashboardWorkload } = load('src/features/reporting/dashboard-insights.tsx', {
    ...mocks,
    '@/lib/server-errors': { reportServerError() {} },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: (name, args) => {
          calls.push([name, args]);
          const b = {
            order: (...args) => {
              calls.push(['order', ...args]);
              return b;
            },
            range: async (...args) => {
              calls.push(['range', ...args]);
              return fail ? { error: new Error('private') } : { data: [] };
            },
          };
          return b;
        },
      }),
    },
  });
  assert.deepEqual(await getDashboardWorkload('org'), []);
  assert.deepEqual(calls[0], ['technician_workload', { org: 'org' }]);
  assert.ok(calls.some((c) => c[0] === 'range' && c[1] === 0 && c[2] === 4));
  fail = true;
  assert.equal(await getDashboardWorkload('org'), null);
});

test('saved daily schedules show their recorded timezone when workspace time changes', () => {
  const { ReportSchedules } = load('src/features/reporting/custom-components.tsx', {
    ...mocks,
    '@/app/app/reports/actions': {
      manageReportSchedule() {},
      saveReportSchedule() {},
      saveReport() {},
      deleteReport() {},
    },
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children }) => React.createElement('button', null, children),
    },
  });
  const date = '2026-10-28T08:00:00Z';
  const html = render(
    React.createElement(ReportSchedules, {
      report: { id: 'report' },
      schedules: [
        {
          id: 'schedule',
          frequency: 'daily',
          run_hour: 8,
          timezone: 'Europe/London',
          format: 'csv',
          recipient_emails: ['it@example.invalid'],
          active: true,
          next_run_at: date,
        },
      ],
      deliveries: [],
      timezone: 'America/Tortola',
      email: 'it@example.invalid',
    }),
  );
  assert.match(html, /Every day.*08:00.*Europe\/London/);
  assert.ok(
    html.includes(
      new Intl.DateTimeFormat('en', {
        timeZone: 'Europe/London',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(date)),
    ),
  );
});
