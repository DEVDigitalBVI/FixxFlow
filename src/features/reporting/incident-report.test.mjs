import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const item = {
  id: 'incident',
  number: 1006,
  title: 'Mail interrupted',
  severity: 'major',
  status: 'in_progress',
  impact: 'Staff cannot send mail.',
  services: ['Mail'],
  locations: ['Office'],
  createdAt: '2026-01-01T10:00Z',
  ticketMinutes: 90,
  downtimeMinutes: null,
  startedAt: null,
  restoredAt: null,
};
const report = {
  summary: {
    total: 1,
    open: 1,
    announcementMinutes: null,
    announcementSamples: 0,
    resolutionMinutes: null,
    resolutionSamples: 0,
    downtimeMinutes: null,
    downtimeSamples: 0,
  },
  breakdowns: [],
  items: [item],
};
async function render(data, error = null, page = 1) {
  const { IncidentReport } = load('src/features/reporting/incident-report.tsx', {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/features/timezones/provider': { Timestamp: () => React.createElement('span', null, 'Time') },
    '@/components/ui/retry-button': {
      RetryButton: () => React.createElement('button', null, 'Retry'),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          assert.equal(name, 'incident_report');
          assert.equal(args.org, 'org');
          return { data, error };
        },
      }),
    },
  });
  return renderToStaticMarkup(await IncidentReport({ organizationId: 'org', page }));
}
test('incident report stays compact, distinguishes missing data, and retains paging and failure recovery', async () => {
  const html = await render(report);
  assert.match(html, /Service downtime/);
  assert.match(html, /No data/);
  assert.match(html, /Open for 1.5h/);
  assert.match(html, /Mail interrupted/);
  assert.match(html, /Staff cannot send mail/);
  assert.match(html, /href="\/app\/tickets\/incident#incident-summary"/);
  assert.doesNotMatch(html, /Incident report pages|<details open/);
  assert.match(
    await render({
      ...report,
      items: Array.from({ length: 21 }, (_, i) => ({ ...item, id: `incident-${i}` })),
    }),
    /Next/,
  );
  assert.match(await render({ ...report, items: [] }, null, 2), /Previous/);
  assert.match(await render(null, { message: 'private failure' }), /role="alert"/);
  assert.doesNotMatch(await render(null, {}), /private failure|Open now/);
});
