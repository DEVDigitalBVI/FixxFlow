import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

test('employee submission validates impact and derives priority from impact rather than a submitted priority', async () => {
  const calls = [];
  const { createTicket } = load('src/app/app/tickets/actions.ts', {
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ id: 'employee', organizationId: 'org', role: 'end_user' }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: 'ticket' };
        },
      }),
    },
    '@/lib/server-errors': { reportServerError() {} },
    'next/cache': { revalidatePath() {} },
    'next/navigation': { redirect() {} },
  });
  const data = new FormData();
  for (const [name, value] of Object.entries({
    title: 'Cannot connect',
    description: 'Connection is down',
    submissionKey: '10000000-0000-0000-0000-000000000001',
    priority: 'critical',
  }))
    data.set(name, value);
  assert.match((await createTicket(data)).error, /Choose how/);
  assert.equal(calls.length, 0);
  data.set('reportedImpact', 'invalid');
  assert.match((await createTicket(data)).error, /Choose how/);
  for (const asset of [null, 'asset']) {
    if (asset) data.set('assetId', asset);
    for (const [impact, priority] of Object.entries({
      minor_inconvenience: 'low',
      work_blocked: 'normal',
      team_affected: 'high',
      operations_stopped: 'critical',
    })) {
      data.set('reportedImpact', impact);
      assert.ok((await createTicket(data)).redirectTo);
      assert.equal(calls.at(-1).args.payload.reported_impact, impact);
      if (!asset) assert.equal(calls.at(-1).args.payload.priority, priority);
    }
  }
});

test('reported impact shows its label and explanation and omits missing historical reports', () => {
  const { ReportedImpact } = load('src/features/tickets/reported-impact.tsx');
  const html = renderToStaticMarkup(
    React.createElement(ReportedImpact, { value: 'operations_stopped' }),
  );
  assert.match(html, /Reported work impact: Operations stopped/);
  assert.match(html, /A critical business service is unavailable/);
  assert.equal(renderToStaticMarkup(React.createElement(ReportedImpact, { value: null })), '');
});
