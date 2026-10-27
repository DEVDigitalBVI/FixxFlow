import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const model = load('src/features/tickets/incidents.ts');
const owner = '10000000-0000-0000-0000-000000000403',
  ticket = '70000000-0000-0000-0000-000000000401';
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    ticketId: ticket,
    revision: '2',
    ticketType: 'incident',
    incidentSeverity: 'major',
    businessImpact: 'Multiple offices cannot connect',
    incidentOwnerId: owner,
    affectedServices: 'Internet\nInternet\n Mail ',
    affectedLocations: 'Main office',
    title: 'Connectivity outage',
    description: 'Multiple teams affected',
    submissionKey: '10000000-0000-0000-0000-000000000411',
  }))
    data.set(key, value);
  return data;
}
function actions(role = 'technician', error = null) {
  const calls = [];
  const ticketActions = load('src/app/app/tickets/actions.ts', {
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ id: owner, organizationId: 'org', role, timeZone: 'UTC' }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push([name, args]);
          return { data: name === 'save_ticket_incident' ? 3 : ticket, error };
        },
      }),
    },
    'next/cache': { revalidatePath() {} },
  });
  return { ...ticketActions, calls };
}
test('incident input separates severity from priority, normalizes names and rejects invalid impact and ownership', () => {
  const data = model.parseIncident(form()).data;
  assert.deepEqual(data.affected_services, ['Internet', 'Mail']);
  assert.equal(data.severity, 'major');
  assert.equal(data.owner_id, owner);
  for (const [key, value] of [
    ['incidentSeverity', 'urgent'],
    ['businessImpact', 'no'],
    ['incidentOwnerId', ''],
    ['affectedLocations', 'x'.repeat(121)],
    ['affectedServices', Array.from({ length: 31 }, (_, i) => 'Service ' + i).join('\n')],
  ]) {
    const input = form();
    input.set(key, value);
    assert.ok(model.parseIncident(input).error, key);
  }
});
test('staff incident creation uses one atomic receipt-backed submission, while ordinary and employee requests stay ordinary', async () => {
  const staff = actions();
  assert.match((await staff.createTicket(form())).redirectTo, /tickets/);
  assert.equal(staff.calls[0][0], 'submit_incident_ticket');
  assert.equal(staff.calls[0][1].payload.incident.severity, 'major');
  assert.equal(staff.calls[0][1].payload.priority, 'normal');
  const ordinary = actions();
  const regular = form();
  regular.set('ticketType', 'support');
  await ordinary.createTicket(regular);
  assert.equal(ordinary.calls[0][0], 'submit_support_request');
  assert.equal(ordinary.calls[0][1].payload.incident, undefined);
  const employee = actions('end_user');
  assert.match((await employee.createTicket(form())).error, /Only IT staff/);
  assert.equal(employee.calls.length, 0);
  regular.delete('ticketType');
  regular.set('reportedImpact', 'work_blocked');
  await employee.createTicket(regular);
  assert.equal(employee.calls[0][0], 'submit_support_request');
});
test('incident updates preserve stale drafts and guard unresolved owners before any write', async () => {
  const stale = actions('technician', { code: 'PT409' });
  assert.equal((await stale.saveIncident(form())).conflict, true);
  const worker = actions();
  const blocked = form();
  blocked.set('lookupLoadError', 'true');
  assert.match((await worker.saveIncident(blocked)).error, /could not load/);
  assert.equal(worker.calls.length, 0);
  assert.deepEqual(await worker.saveIncident(form()), {
    success: 'Incident details saved.',
    revision: 3,
  });
  assert.equal(worker.calls[0][1].expected_revision, 2);
  const employee = actions('end_user');
  assert.ok((await employee.saveIncident(form())).error);
  assert.equal(employee.calls.length, 0);
});
test('incident creation reveals coordination only when staff select Incident', () => {
  const ui = componentHarness('src/features/tickets/incident-fields.tsx', 'IncidentCreateFields', {
    ownerId: owner,
  });
  try {
    assert.equal(ui.all((n) => n.props.ownerId === owner).length, 0);
    ui.find((n) => n.props.name === 'ticketType').props.onChange({ target: { value: 'incident' } });
    ui.render();
    assert.equal(ui.all((n) => n.props.ownerId === owner).length, 1);
    ui.find((n) => n.props.name === 'ticketType').props.onChange({ target: { value: 'support' } });
    ui.render();
    assert.equal(ui.find((n) => n.props.ownerId === owner).props.disabled, true);
    assert.equal(ui.all((n) => n.props.hidden === true).length, 1);
  } finally {
    ui.close();
  }
  const { IncidentFields } = load('src/features/tickets/incident-fields.tsx');
  const html = renderToStaticMarkup(React.createElement(IncidentFields, { ownerId: owner }));
  assert.match(html, /<legend>Incident coordination/);
  assert.match(html, /Ticket priority controls urgency/);
  assert.match(html, /name="businessImpact"[^>]*required/);
  assert.match(html, /name="incidentOwnerId"/);
  assert.match(html, /IT staff only/);
});
test('incident editor retains its revision and offers explicit review and reload after conflict', async () => {
  const props = { ticketId: ticket, ticketRevision: 2, incident: null, ownerId: owner };
  let refreshes = 0;
  const ui = componentHarness('src/features/tickets/incident-editor.tsx', 'IncidentEditor', props, {
    '@/app/app/tickets/actions': {
      saveIncident: async () => ({ conflict: true, error: 'Conflict' }),
    },
    'next/navigation': {
      useRouter: () => ({
        refresh() {
          refreshes++;
        },
      }),
    },
  });
  try {
    await ui.find((n) => typeof n.props.action === 'function').props.action(form());
    props.ticketRevision = 3;
    ui.render();
    assert.equal(ui.find((n) => n.props.name === 'revision').props.value, 2);
    assert.match(
      ui.find((n) => n.props.role === 'status').props.children[0].props.children,
      /draft is preserved/,
    );
    assert.equal(refreshes, 1);
  } finally {
    ui.close();
  }
});

test('incident summaries retain safe error recovery, written severity and company-scoped reads', async () => {
  const record = {
    ticket_id: ticket,
    organization_id: 'org',
    severity: 'major',
    business_impact: '<script>Confidential impact</script>',
    owner_id: owner,
    affected_services: ['Mail'],
    affected_locations: ['Main office'],
  };
  for (const mode of ['present', 'missing', 'error', 'owner-error']) {
    const calls = [];
    const query = new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'maybeSingle'
            ? async () => ({
                data: mode === 'missing' ? null : record,
                error: mode === 'error' ? {} : null,
              })
            : (...args) => {
                calls.push([key, ...args]);
                return query;
              },
      },
    );
    const { IncidentPanel } = load('src/features/tickets/incident-panel.tsx', {
      'next/navigation': { useRouter: () => ({ refresh() {} }) },
      '@/lib/supabase/server': { createClient: async () => ({ from: () => query }) },
      '@/features/lookups/labels': {
        profileLabels: async () => {
          if (mode === 'owner-error') throw Error('Unavailable');
          return [{ display_name: 'Incident coordinator' }];
        },
      },
      './incident-control-panel': { IncidentControlPanel: () => null },
      './communication-panel': { CommunicationPanel: () => null },
      './checklist-panel': { ChecklistPanel: () => null },
      './incident-editor': {
        IncidentEditor: () => React.createElement('div', null, 'Incident editor'),
      },
    });
    const html = renderToStaticMarkup(
      await IncidentPanel({ organizationId: 'org', ticketId: ticket, revision: 2, ownerId: owner }),
    );
    assert.ok(calls.some((c) => c[0] === 'eq' && c[1] === 'organization_id' && c[2] === 'org'));
    if (mode === 'error') {
      assert.match(html, /could not load/);
      assert.doesNotMatch(html, /Incident editor/);
    } else if (mode === 'missing') assert.match(html, /Declare an incident/);
    else {
      assert.match(html, /Severity: Major/);
      assert.match(html, /Mail/);
      assert.match(html, /Main office/);
      assert.match(html, /&lt;script&gt;Confidential/);
      assert.doesNotMatch(html, /<script>/);
      if (mode === 'owner-error') assert.match(html, /owner name could not load/);
    }
  }
});

test('service timing remains optional and rejects future, reversed and ambiguous local times', () => {
  const valid = form();
  valid.set('disruptionAt', '2026-01-01T10:00');
  valid.set('disruptionTimezone', 'UTC');
  valid.set('restoredAt', '2026-01-01T11:30');
  valid.set('restoredTimezone', 'UTC');
  const result = model.parseIncident(valid);
  assert.equal(result.data.disruption_started_at, '2026-01-01T10:00:00.000Z');
  assert.equal(result.data.service_restored_at, '2026-01-01T11:30:00.000Z');
  valid.set('restoredAt', '2026-01-01T09:00');
  assert.match(model.parseIncident(valid).error, /on or after/);
  valid.set('restoredAt', '');
  valid.set('disruptionAt', '2099-01-01T10:00');
  assert.match(model.parseIncident(valid).error, /past/);
  valid.set('disruptionAt', '2025-11-02T01:30');
  valid.set('disruptionTimezone', 'America/New_York');
  assert.ok(model.parseIncident(valid).error);
  valid.set('disruptionOccurrence', 'earlier');
  assert.equal(model.parseIncident(valid).data.disruption_started_at, '2025-11-02T05:30:00.000Z');
});
