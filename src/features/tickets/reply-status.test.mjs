import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const id = '11111111-1111-4111-8111-111111111111';
function form(status = 'resolved') {
  const data = new FormData();
  for (const [k, v] of Object.entries({
    ticketId: id,
    messageId: id,
    kind: 'reply',
    body: 'Fixed',
    revision: '7',
    status,
  }))
    data.set(k, v);
  return data;
}
function fixture({
  role = 'technician',
  result = {
    data: [{ message_sent: true, status_changed: true, revision: 9, already_sent: false }],
    error: null,
  },
  thrown,
} = {}) {
  const calls = [];
  const actions = load('src/app/app/tickets/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ id: 'worker', organizationId: 'org', role }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          if (thrown) throw thrown;
          return result;
        },
        from() {
          throw Error('Must use atomic RPC');
        },
      }),
    },
    '@/lib/server-errors': { reportServerError: () => 'test' },
  });
  return { send: actions.replyAndSetStatus, calls };
}
test('combined action calls only the atomic RPC with the original identity and revision', async () => {
  const f = fixture();
  const result = await f.send(form());
  assert.equal(result.messageSent, true);
  assert.equal(result.statusChanged, true);
  assert.equal(result.revision, 9);
  assert.deepEqual(f.calls, [
    {
      name: 'reply_and_set_ticket_status',
      args: {
        ticket_id: id,
        message_id: id,
        body: 'Fixed',
        status: 'resolved',
        expected_revision: 7,
      },
    },
  ]);
  assert.match(result.success, /Ticket resolved/);
});
test('waiting confirmation explains the paused resolution SLA', async () => {
  const f = fixture();
  assert.match(
    (await f.send(form('waiting_on_user'))).success,
    /Waiting on the requester’s reply; resolution SLA paused/,
  );
});
for (const code of ['PT409', '40001', '42501', '22023', 'PT422'])
  test(`RPC ${code} rejection confirms nothing was sent`, async () => {
    const f = fixture({ result: { data: null, error: { code } } });
    const result = await f.send(form());
    assert.equal(result.messageSent, false);
    assert.equal(result.statusChanged, false);
    assert.ok(result.error);
    assert.equal(Boolean(result.conflict), ['PT409', '40001'].includes(code));
  });
test('uncertain network outcomes do not falsely report rollback or partial success', async () => {
  for (const f of [
    fixture({ thrown: Error('Lost response') }),
    fixture({ result: { data: null, error: { code: 'PGRST000' } } }),
    fixture({ result: { data: [], error: null } }),
  ])
    await assert.rejects(f.send(form()));
});
test('receipt retry confirms original success, while a legacy plain reply reports only its confirmed message', async () => {
  const saved = fixture({
    result: {
      data: [{ message_sent: true, status_changed: true, revision: 9, already_sent: true }],
      error: null,
    },
  });
  assert.match((await saved.send(form())).success, /already saved/);
  const legacy = fixture({
    result: {
      data: [{ message_sent: true, status_changed: false, revision: 10, already_sent: true }],
      error: null,
    },
  });
  const result = await legacy.send(form());
  assert.equal(result.messageSent, true);
  assert.equal(result.statusChanged, false);
  assert.match(result.error, /already sent/);
});
test('employees, notes, holds and malformed submissions are rejected before RPC', async () => {
  const employee = fixture({ role: 'end_user' });
  assert.ok((await employee.send(form())).error);
  assert.equal(employee.calls.length, 0);
  for (const [key, value] of [
    ['kind', 'internal_note'],
    ['status', 'on_hold'],
    ['revision', '0'],
    ['messageId', 'bad'],
    ['ticketId', 'bad'],
    ['body', ' '],
    ['body', 'a'.repeat(20001)],
  ]) {
    const f = fixture();
    const data = form();
    data.set(key, value);
    assert.ok((await f.send(data)).error);
    assert.equal(f.calls.length, 0);
  }
});

test('composer clears only the sent draft on partial success and preserves original retry revision', async () => {
  let call = 0;
  const received = [];
  const props = {
    ticketId: id,
    revision: 7,
    action: async () => ({ success: 'Sent' }),
    statusAction: async (data) => {
      received.push(Object.fromEntries(data));
      if (++call === 1) throw Error('Lost response');
      return { messageSent: true, statusChanged: false, error: 'Reply sent. Status not changed.' };
    },
  };
  const h = componentHarness(
    'src/features/tickets/message-composer.tsx',
    'MessageComposer',
    props,
    {
      'next/navigation': { useRouter: () => ({ refresh() {} }) },
      '@/components/ui/unsaved-changes': { useUnsavedChanges() {} },
    },
  );
  try {
    h.find((n) => n.props.id === 'message-body').props.onChange({
      target: { value: 'Public draft' },
    });
    h.render();
    h.find(
      (n) => n.props.name === 'composerMode' && n.props.value === 'internal_note',
    ).props.onChange();
    h.render();
    h.find((n) => n.props.id === 'message-body').props.onChange({
      target: { value: 'Private draft' },
    });
    h.render();
    assert.equal(h.all((n) => n.props.name === 'status').length, 0);
    h.find((n) => n.props.name === 'composerMode' && n.props.value === 'reply').props.onChange();
    h.render();
    props.revision = 8;
    h.render();
    h.submit(form());
    await new Promise(setImmediate);
    h.render();
    assert.equal(h.find((n) => n.props.id === 'message-body').props.value, 'Public draft');
    props.revision = 8;
    h.render();
    h.submit(form());
    await new Promise(setImmediate);
    h.render();
    assert.equal(received[0].revision, '7', 'refresh while drafting retains the original revision');
    assert.equal(received[0].messageId, received[1].messageId);
    assert.equal(received[1].revision, '7');
    assert.equal(h.find((n) => n.props.id === 'message-body').props.value, '');
    assert.ok(h.find((n) => n.props.href === '#ticket-status'));
    h.find(
      (n) => n.props.name === 'composerMode' && n.props.value === 'internal_note',
    ).props.onChange();
    h.render();
    assert.equal(h.find((n) => n.props.id === 'message-body').props.value, 'Private draft');
  } finally {
    h.close();
  }
});

test('composer offers status actions only for appropriate public replies', () => {
  for (const [status, expected] of [
    ['open', ['waiting_on_user', 'resolved']],
    ['waiting_on_user', ['resolved']],
    ['resolved', []],
    ['closed', []],
  ]) {
    const h = componentHarness(
      'src/features/tickets/message-composer.tsx',
      'MessageComposer',
      {
        ticketId: id,
        ticketStatus: status,
        revision: 7,
        action: async () => ({}),
        statusAction: async () => ({}),
      },
      { 'next/navigation': { useRouter: () => ({ refresh() {} }) } },
    );
    try {
      assert.deepEqual(
        h.all((n) => n.props.name === 'status').map((n) => n.props.value),
        expected,
      );
      h.find(
        (n) => n.props.name === 'composerMode' && n.props.value === 'internal_note',
      ).props.onChange();
      h.render();
      assert.equal(h.all((n) => n.props.name === 'status').length, 0);
    } finally {
      h.close();
    }
  }
});
test('dirty status blocks combined sends without blocking plain replies', async () => {
  let calls = 0;
  const state = { replyStatusBlocked: true, beginReplyStatus: () => false, endReplyStatus() {} };
  const h = componentHarness(
    'src/features/tickets/message-composer.tsx',
    'MessageComposer',
    {
      ticketId: id,
      ticketStatus: 'open',
      revision: 7,
      action: async () => ({}),
      statusAction: async () => {
        calls++;
        return {};
      },
    },
    {
      'next/navigation': { useRouter: () => ({ refresh() {} }) },
      './ticket-mutation-state': { useTicketMutationState: () => state },
    },
  );
  try {
    for (const b of h.all((n) => n.props.name === 'status')) assert.equal(b.props.disabled, true);
    assert.equal(
      h.find((n) => n.type === 'button' && n.props.variant === 'primary').props.disabled,
      false,
    );
    h.submit(form());
    await new Promise(setImmediate);
    assert.equal(calls, 0);
  } finally {
    h.close();
  }
});
test('genuine conflict keeps draft until the worker explicitly adopts the reviewed version', async () => {
  const props = {
    ticketId: id,
    ticketStatus: 'open',
    revision: 7,
    action: async () => ({}),
    statusAction: async () => ({ error: 'Ticket changed', messageSent: false, conflict: true }),
  };
  let refreshes = 0;
  const h = componentHarness(
    'src/features/tickets/message-composer.tsx',
    'MessageComposer',
    props,
    {
      'next/navigation': {
        useRouter: () => ({
          refresh() {
            refreshes++;
          },
        }),
      },
    },
  );
  try {
    h.find((n) => n.props.id === 'message-body').props.onChange({ target: { value: 'Question' } });
    h.render();
    h.submit(form());
    await new Promise(setImmediate);
    h.render();
    assert.equal(h.find((n) => n.props.id === 'message-body').props.value, 'Question');
    assert.equal(refreshes, 1);
    props.revision = 8;
    h.render();
    h.find(
      (n) => n.type === 'button' && String(n.props.children).includes('Use reviewed'),
    ).props.onClick();
    h.render();
    let version;
    props.statusAction = async (data) => {
      version = data.get('revision');
      return { messageSent: true, statusChanged: true };
    };
    h.render();
    h.submit(form());
    await new Promise(setImmediate);
    assert.equal(version, '8');
  } finally {
    h.close();
  }
});

test('ticket mutation scope prevents dirty and simultaneous action races and releases locks', () => {
  const h = componentHarness(
    'src/features/tickets/ticket-mutation-state.tsx',
    'TicketMutationProvider',
    { children: null },
  );
  const state = () => {
    h.render();
    return h.find((n) => n.props.value?.beginWork).props.value;
  };
  try {
    let s = state();
    s.setWorkDirty(true);
    assert.equal(s.beginReplyStatus(), false);
    assert.equal(state().replyStatusBlocked, true);
    s.setWorkDirty(false);
    assert.equal(s.beginReplyStatus(), true);
    assert.equal(s.beginWork(), false);
    assert.equal(state().workBlocked, true);
    s.endReplyStatus();
    assert.equal(s.beginWork(), true);
    assert.equal(s.beginReplyStatus(), false);
    s.endWork();
    assert.equal(state().replyStatusBlocked, false);
  } finally {
    h.close();
  }
});

test('a definite conflict does not silently reuse the old combined action when plain Send is chosen', async () => {
  let combined = 0,
    plain = 0;
  const h = componentHarness(
    'src/features/tickets/message-composer.tsx',
    'MessageComposer',
    {
      ticketId: id,
      revision: 7,
      ticketStatus: 'open',
      action: async () => {
        plain++;
        return { success: 'Sent' };
      },
      statusAction: async () => {
        combined++;
        return { error: 'Changed', conflict: true, messageSent: false };
      },
    },
    { 'next/navigation': { useRouter: () => ({ refresh() {} }) } },
  );
  try {
    h.submit(form());
    await new Promise(setImmediate);
    h.render();
    const data = form();
    data.delete('status');
    h.submit(data);
    await new Promise(setImmediate);
    assert.equal(combined, 1);
    assert.equal(plain, 1);
  } finally {
    h.close();
  }
});

test('status controls publish unsaved changes and cannot submit during a combined reply', async () => {
  let dirty = false,
    calls = 0,
    workBlocked = true;
  const state = {
    get workBlocked() {
      return workBlocked;
    },
    setWorkDirty(value) {
      dirty = value;
    },
    beginWork: () => !workBlocked,
    endWork() {},
  };
  const h = componentHarness(
    'src/features/tickets/work-actions.tsx',
    'TicketWorkActions',
    {
      ticket: { id, revision: 7, status: 'open', assigned_technician_id: 'worker' },
      assignee: 'Worker',
    },
    {
      'next/navigation': { useRouter: () => ({ refresh() {} }) },
      '@/features/timezones/provider': { useTimezone: () => 'UTC' },
      './ticket-mutation-state': { useTicketMutationState: () => state },
      '@/app/app/tickets/actions': {
        workTicket: async () => {
          calls++;
          return { success: 'Saved', revision: 8 };
        },
      },
    },
  );
  try {
    assert.equal(
      h.find((n) => n.type === 'fieldset' && n.props.className === 'ticket-work-controls').props
        .disabled,
      true,
    );
    const action = h.find((n) => n.props.className === 'ticket-status-action').props.action;
    await action(new FormData());
    assert.equal(calls, 0);
    workBlocked = false;
    h.render();
    h.find((n) => n.type === 'select').props.onChange({ target: { value: 'waiting_on_user' } });
    assert.equal(dirty, true);
    h.render();
    h.find((n) => n.type === 'select').props.onChange({ target: { value: 'open' } });
    assert.equal(dirty, false);
    await action(new FormData());
    assert.equal(calls, 1);
  } finally {
    h.close();
  }
});
