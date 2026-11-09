import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const initial = { id: 'ticket', revision: 1, status: 'open', assigned_technician_id: null };
const mocks = {
  '@/features/timezones/provider': { useTimezone: () => 'UTC', Timestamp: ({ value }) => value },
  'next/navigation': { useRouter: () => ({ refresh() {} }) },
  '@/app/app/tickets/actions': { workTicket: async () => ({ success: 'Saved', revision: 2 }) },
  '@/components/ui/action-form': {
    ActionForm: ({ children }) => React.createElement('form', null, children),
  },
  '@/components/ui/submit-button': {
    SubmitButton: ({ children }) => React.createElement('button', null, children),
  },
};
test('staff work controls show actions appropriate to unassigned, working and resolved tickets', () => {
  const { TicketWorkActions } = load('src/features/tickets/work-actions.tsx', mocks);
  for (const [ticket, present, absent] of [
    [initial, ['Assign to me', 'Save status'], ['Start work', 'Mark resolved']],
    [
      { ...initial, assigned_technician_id: 'worker' },
      ['Start work', 'Save status'],
      ['Assign to me', 'Mark resolved'],
    ],
    [
      { ...initial, status: 'in_progress', assigned_technician_id: 'worker' },
      ['Save status'],
      ['Start work', 'Mark resolved'],
    ],
    [
      { ...initial, status: 'resolved' },
      ['reopen this ticket', 'Save status'],
      ['Assign to me', 'Start work', 'Mark resolved'],
    ],
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(TicketWorkActions, { ticket, assignee: 'Unassigned' }),
    );
    for (const text of present) assert.ok(html.includes(text), text);
    for (const text of absent) assert.ok(!html.includes(text), text);
    assert.match(html, /href="#ticket-conversation"/);
    assert.match(html, /<label>Status<select/);
  }
});
test('background updates preserve a changed status draft; explicit review adopts the new revision', async () => {
  const props = { ticket: initial, assignee: 'Unassigned' },
    h = componentHarness(
      'src/features/tickets/work-actions.tsx',
      'TicketWorkActions',
      props,
      mocks,
    );
  try {
    h.find((n) => n.type === 'select').props.onChange({ target: { value: 'waiting_on_user' } });
    h.render();
    props.ticket = { ...initial, revision: 2, assigned_technician_id: 'someone' };
    h.render();
    assert.equal(h.find((n) => n.props.className === 'ticket-work-controls').props.disabled, true);
    h.find((n) => n.type === 'button').props.onClick();
    h.render();
    assert.equal(h.find((n) => n.props.name === 'revision').props.value, 2);
    const form = h.find((n) => typeof n.props.action === 'function');
    await form.props.action(new FormData());
    h.render();
    assert.equal(h.find((n) => n.props.name === 'revision').props.value, 2);
  } finally {
    h.close();
  }
});

test('first status choice survives assignment and start revisions and is retained on unrelated refresh', () => {
  const props = { ticket: initial, assignee: 'Unassigned' },
    h = componentHarness(
      'src/features/tickets/work-actions.tsx',
      'TicketWorkActions',
      props,
      mocks,
    );
  try {
    props.ticket = {
      ...initial,
      revision: 3,
      status: 'in_progress',
      assigned_technician_id: 'worker',
    };
    h.render();
    assert.equal(h.find((n) => n.type === 'select').props.value, 'in_progress');
    h.find((n) => n.type === 'select').props.onChange({ target: { value: 'waiting_on_user' } });
    h.render();
    assert.equal(h.find((n) => n.type === 'select').props.value, 'waiting_on_user');
    assert.equal(h.find((n) => n.props.className === 'ticket-status-action').key, null);
    assert.equal(h.find((n) => n.props.name === 'revision').props.value, 3);
    h.render();
    assert.equal(h.find((n) => n.type === 'select').props.value, 'waiting_on_user');
    props.ticket = { ...props.ticket, revision: 4 };
    h.render();
    assert.equal(h.find((n) => n.props.className === 'ticket-work-controls').props.disabled, true);
    h.find((n) => n.type === 'button').props.onClick();
    h.render();
    assert.equal(h.find((n) => n.type === 'select').props.value, 'in_progress');
    assert.equal(h.find((n) => n.props.name === 'revision').props.value, 4);
  } finally {
    h.close();
  }
});

test('Resolve provides an explicit save for every status and submits the selected draft', async () => {
  const calls = [];
  const h = componentHarness(
    'src/features/tickets/work-actions.tsx',
    'TicketWorkActions',
    {
      ticket: { ...initial, assigned_technician_id: 'worker' },
      assignee: 'Worker',
      stage: 'resolution',
    },
    {
      ...mocks,
      '@/app/app/tickets/actions': {
        workTicket: async (data) => {
          calls.push(data);
          return { error: 'Try again' };
        },
      },
    },
  );
  try {
    const { ticketStatuses } = load('src/features/tickets/presentation.ts');
    assert.equal(h.all((n) => n.props.children === 'Mark resolved').length, 0);
    assert.equal(h.all((n) => n.props.name === 'status').length, 1);
    assert.equal(h.find((n) => n.props.children === 'Save status').props.variant, 'primary');
    for (const status of Object.keys(ticketStatuses)) {
      h.find((n) => n.type === 'select').props.onChange({ target: { value: status } });
      h.render();
      const select = h.find((n) => n.type === 'select');
      assert.equal(select.props.value, status);
      const hint = h.find((n) => n.props.id === select.props['aria-describedby']);
      assert.match(
        hint.props.children,
        status === initial.status ? /Choose a status/ : /Unsaved status:/,
      );
      const data = new FormData();
      for (const input of h.all((n) => n.type === 'input' && n.props.name))
        data.set(input.props.name, String(input.props.value));
      data.set('status', select.props.value);
      await h.find((n) => n.props.className === 'ticket-status-action').props.action(data);
      h.render();
      assert.equal(calls.at(-1).get('status'), status);
      assert.equal(calls.at(-1).get('intent'), 'status');
      assert.equal(
        h.find((n) => n.type === 'select').props.value,
        status,
        'failure retains the draft',
      );
    }
  } finally {
    h.close();
  }
});

test('status guidance remains outside the forms and linked to the status select', () => {
  const { TicketWorkActions } = load('src/features/tickets/work-actions.tsx', mocks);
  const html = renderToStaticMarkup(
    React.createElement(TicketWorkActions, { ticket: initial, assignee: 'Unassigned' }),
  );
  assert.ok(html.indexOf('ticket-work-guidance') > html.lastIndexOf('</form>'));
  const hintId = html.match(/aria-describedby="([^"]+)"/)[1];
  assert.ok(html.includes('id="' + hintId + '"'));
  assert.match(html, /button-secondary[^>]*" href="#ticket-conversation"/);
});

test('an unsaved status guards navigation until restored or successfully saved', async () => {
  let protectedDraft = false;
  let fail = true;
  const h = componentHarness(
    'src/features/tickets/work-actions.tsx',
    'TicketWorkActions',
    { ticket: initial, assignee: 'Unassigned' },
    {
      ...mocks,
      '@/components/ui/unsaved-changes': {
        useUnsavedChanges: (dirty) => {
          protectedDraft = dirty;
          return () => {
            protectedDraft = false;
          };
        },
      },
      '@/app/app/tickets/actions': {
        workTicket: async () => (fail ? { error: 'Retry' } : { success: 'Saved', revision: 2 }),
      },
    },
  );
  try {
    const change = (value) => {
      h.find((n) => n.type === 'select').props.onChange({ target: { value } });
      h.render();
    };
    change('resolved');
    assert.equal(protectedDraft, true);
    change('open');
    assert.equal(protectedDraft, false);
    change('resolved');
    await h.find((n) => n.props.className === 'ticket-status-action').props.action(new FormData());
    h.render();
    assert.equal(protectedDraft, true, 'failed saves keep navigation protection');
    fail = false;
    await h.find((n) => n.props.className === 'ticket-status-action').props.action(new FormData());
    h.render();
    assert.equal(protectedDraft, false);
  } finally {
    h.close();
  }
});

test('on-hold controls expose required labeled follow-up fields and explicit resume', () => {
  const { TicketWorkActions } = load('src/features/tickets/work-actions.tsx', mocks);
  const html = renderToStaticMarkup(
    React.createElement(TicketWorkActions, {
      ticket: {
        ...initial,
        status: 'on_hold',
        assigned_technician_id: 'worker',
        hold_reason: 'vendor',
        hold_note: 'Replacement scheduled',
        hold_review_at: '2027-01-01T12:00:00Z',
      },
      assignee: 'IT worker',
    }),
  );
  assert.match(html, /Resume work/);
  assert.match(html, /<fieldset[^>]*>[\s\S]*<legend>Hold &amp; follow-up<\/legend>/);
  assert.match(html, /name="holdReason" required/);
  assert.match(html, /name="holdNote" required/);
  assert.match(
    html,
    /<input(?=[^>]*name="holdReviewAt")(?=[^>]*type="datetime-local")(?=[^>]*required)[^>]*>/,
  );
  assert.match(html, /visible to the requester/);
  assert.match(html, /does not extend the SLA or automatically resume work/);
});
