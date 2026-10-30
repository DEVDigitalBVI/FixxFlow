import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { kitHostMocks } from '../../../tests/helpers/kit-host-mocks.mjs';
import { load as loadModule } from '../../../tests/helpers/load-module.mjs';

function load(file, mocks = {}) {
  return loadModule(file, {
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    ...mocks,
  });
}
const { ConversationTimeline } = load('src/features/tickets/conversation-timeline.tsx');
const { MessageComposer } = load('src/features/tickets/message-composer.tsx');
const messages = [
  {
    id: 'public',
    author_id: 'worker',
    kind: 'reply',
    body: 'Public answer',
    created_at: '2026-09-24T10:00:00Z',
  },
  {
    id: 'private',
    author_id: 'worker',
    kind: 'internal_note',
    body: 'Private diagnosis',
    created_at: '2026-09-24T10:01:00Z',
  },
];
const renderTimeline = (staff) =>
  renderToStaticMarkup(
    React.createElement(ConversationTimeline, {
      messages,
      names: new Map([['worker', 'Support']]),
      viewerId: 'requester',
      requesterId: 'requester',
      staff,
      error: false,
    }),
  );

test('employee conversation excludes private content and private message labels', () => {
  const html = renderTimeline(false);
  assert.match(html, /Public answer/);
  assert.doesNotMatch(html, /Private diagnosis|Internal note|IT staff only/);
});
test('staff history labels both audiences and preserves timestamps for notes', () => {
  const html = renderTimeline(true);
  assert.match(html, /Public reply/);
  assert.match(html, /Internal note/);
  assert.match(html, /IT staff only/);
  assert.match(html, /dateTime="2026-09-24T10:01:00Z"/);
});
test('staff composer starts with a clearly labeled requester reply and offers private notes', () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageComposer, { ticketId: 'ticket', action: async () => ({}) }),
  );
  assert.match(html, /name="kind" value="reply"/);
  assert.match(html, /type="radio"/);
  assert.match(html, /Send public reply/);
  assert.match(html, /Visible to the requester and IT staff/);
  assert.match(html, /aria-describedby="message-audience message-hint"/);
  assert.match(html, /Enter adds a new line/);
});
test('employee composer exposes only public replies', () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageComposer, {
      ticketId: 'ticket',
      staff: false,
      action: async () => ({}),
    }),
  );
  assert.match(html, /name="kind" value="reply"/);
  assert.match(html, /Send message/);
  assert.doesNotMatch(html, /type="radio"|Internal note|public reply/i);
});
test('successful replies retain their audience and preserve the other draft', async () => {
  const submitted = [];
  let complete;
  const harness = componentHarness(
    'src/features/tickets/message-composer.tsx',
    'MessageComposer',
    {
      ticketId: id,
      action: (data) => {
        submitted.push(data);
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    },
    {
      'next/navigation': { useRouter: () => ({ refresh() {} }) },
      '@/components/ui/unsaved-changes': { useUnsavedChanges() {} },
    },
  );
  const NativeFormData = globalThis.FormData;
  // The harness supplies submitted fields in place of a browser HTMLFormElement.
  globalThis.FormData = class extends NativeFormData {
    constructor(form) {
      super();
      if (form) for (const [key, value] of form.entries()) this.set(key, value);
    }
  };
  const textarea = () => harness.find((node) => node.type === 'textarea');
  const choose = (kind) => {
    harness
      .find(
        (node) => node.type === 'input' && node.props.type === 'radio' && node.props.value === kind,
      )
      .props.onChange();
    harness.render();
  };
  try {
    choose('internal_note');
    textarea().props.onChange({ target: { value: 'Private diagnostic draft' } });
    choose('reply');
    textarea().props.onChange({ target: { value: 'Public update' } });
    harness.render();
    const form = harness.find((node) => node.type === 'form');
    assert.equal(
      form.props.action,
      undefined,
      'Native action reset must not change the visible audience',
    );
    let prevented = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
      currentTarget: messageForm('reply', 'Public update'),
    };
    form.props.onSubmit(event);
    form.props.onSubmit(event);
    assert.equal(prevented, true);
    assert.equal(submitted.length, 1, 'Pending submissions must not duplicate a message');
    complete({ success: 'Public reply sent.' });
    await new Promise((resolve) => setImmediate(resolve));
    harness.render();
    assert.equal(textarea().props.value, '');
    assert.equal(
      harness.find(
        (node) =>
          node.type === 'input' && node.props.type === 'radio' && node.props.value === 'reply',
      ).props.checked,
      true,
    );
    assert.equal(
      harness.find((node) => node.type === 'input' && node.props.name === 'kind').props.value,
      'reply',
    );
    choose('internal_note');
    assert.equal(textarea().props.value, 'Private diagnostic draft');
    harness
      .find((node) => node.type === 'form')
      .props.onSubmit({
        preventDefault() {},
        currentTarget: messageForm('internal_note', 'Private diagnostic draft'),
      });
    assert.equal(submitted[1].get('kind'), 'internal_note');
    assert.equal(submitted[1].get('body'), 'Private diagnostic draft');
    complete({ error: 'Temporary failure' });
    await new Promise((resolve) => setImmediate(resolve));
    harness.render();
    assert.equal(textarea().props.value, 'Private diagnostic draft');
  } finally {
    globalThis.FormData = NativeFormData;
    harness.close();
  }
});
test('message text is escaped instead of rendered as HTML', () => {
  const html = renderToStaticMarkup(
    React.createElement(ConversationTimeline, {
      messages: [{ ...messages[0], body: '<script>alert(1)</script>' }],
      names: new Map(),
      viewerId: 'requester',
      requesterId: 'requester',
      staff: true,
      error: false,
    }),
  );
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
test('automation notes have a system label, never impersonate a human, and remain hidden from employees', () => {
  const messages = [
    {
      id: 'automation-note',
      author_id: null,
      author_type: 'automation',
      automation_name: 'Critical <Routing>',
      kind: 'internal_note',
      body: 'Automated diagnosis',
      created_at: '2026-10-01T01:00:00Z',
    },
  ];
  const render = (staff) =>
    renderToStaticMarkup(
      React.createElement(ConversationTimeline, {
        messages,
        names: new Map(),
        viewerId: 'human',
        requesterId: 'requester',
        staff,
        error: false,
      }),
    );
  const html = render(true);
  assert.match(html, /Automation: Critical &lt;Routing&gt;/);
  assert.match(html, /Internal note/);
  assert.match(html, /IT staff only/);
  assert.doesNotMatch(html, /Team member|<strong>You/);
  assert.doesNotMatch(render(false), /Critical|Automated diagnosis/);
});

const id = '11111111-1111-4111-8111-111111111111';
function messageForm(kind, body = 'Hello') {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ticketId: id, messageId: id, kind, body }))
    data.set(key, value);
  return data;
}
function actionFor(role, database) {
  return load('src/app/app/tickets/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ id: 'viewer', role, organizationId: 'org' }),
    },
    '@/lib/supabase/server': { createClient: async () => database },
  }).addTicketMessage;
}
test('server rejects employee internal notes before touching the database', async () => {
  const result = await actionFor('end_user', {
    from() {
      throw new Error('Must not write');
    },
  })(messageForm('internal_note'));
  assert.ok(result.error);
});
test('server rejects blank and oversized messages', async () => {
  const send = actionFor('technician', {
    from() {
      throw new Error('Must not write');
    },
  });
  assert.ok((await send(messageForm('reply', '   '))).error);
  assert.ok((await send(messageForm('reply', 'a'.repeat(20001)))).error);
});
test('server persists the explicit audience and stable retry ID', async () => {
  let inserted;
  const send = actionFor('technician', {
    from: () => ({
      insert: async (row) => {
        inserted = row;
        return { error: null };
      },
    }),
  });
  assert.ok((await send(messageForm('internal_note'))).success);
  assert.equal(inserted.kind, 'internal_note');
  assert.equal(inserted.id, id);
});
test('lost-response retries succeed only for an identical existing message', async () => {
  let existing = { id, body: 'Hello', kind: 'internal_note', author_id: 'viewer', ticket_id: id };
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: async () => ({ data: existing }),
    insert: async () => ({ error: { code: '23505' } }),
  };
  const send = actionFor('technician', { from: () => query });
  assert.ok((await send(messageForm('internal_note'))).success);
  existing = { ...existing, kind: 'reply' };
  assert.ok((await send(messageForm('internal_note'))).error);
});

const { ChatRoom } = load('src/features/chat/chat-room.tsx', {
  '@/lib/supabase/client': { createClient: () => ({}) },
});
const chatProps = {
  conversationId: 'chat',
  organizationId: 'org',
  viewerId: 'staff',
  isWorker: true,
  open: true,
  names: {},
  initialMessages: [],
  attachments: [],
};
test('live support defaults to internal notes and blocks shared attachments on notes', () => {
  const html = renderToStaticMarkup(React.createElement(ChatRoom, chatProps));
  assert.match(html, /value="internal_note" selected=""/);
  assert.match(html, /Only IT staff can see this note/);
  assert.match(html, /Files are always shared with the employee/);
  assert.match(html, /type="file"[^>]*disabled=""/);
  assert.match(html, /aria-describedby="chat-audience"/);
});
test('employee live support offers a public composer only', () => {
  const html = renderToStaticMarkup(
    React.createElement(ChatRoom, { ...chatProps, isWorker: false }),
  );
  assert.doesNotMatch(html, /Internal note|chat-kind/);
  assert.match(html, /Shared with IT support/);
});
test('switching live chat audience keeps independent drafts', () => {
  const hooks = [];
  let cursor = 0;
  const fakeReact = {
    ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial;
      return [
        hooks[i],
        (next) => {
          hooks[i] = typeof next === 'function' ? next(hooks[i]) : next;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { current: initial };
      return hooks[i];
    },
    useCallback: (callback) => callback,
    useEffect() {},
    useTransition: () => [false, (fn) => fn()],
  };
  const { ChatRoom: Room } = load('src/features/chat/chat-room.tsx', {
    ...kitHostMocks(),
    react: fakeReact,
    '@/lib/supabase/client': { createClient: () => ({}) },
  });
  const render = () => {
    cursor = 0;
    return Room(chatProps);
  };
  const find = (node, type) => {
    if (node?.type === type) return node;
    for (const child of React.Children.toArray(node?.props?.children)) {
      const result = find(child, type);
      if (result) return result;
    }
  };
  let tree = render();
  find(tree, 'textarea').props.onChange({ target: { value: 'Private diagnosis' } });
  find(tree, 'select').props.onChange({ target: { value: 'message' } });
  tree = render();
  assert.equal(find(tree, 'textarea').props.value, '');
  find(tree, 'textarea').props.onChange({ target: { value: 'Public update' } });
  find(tree, 'select').props.onChange({ target: { value: 'internal_note' } });
  assert.equal(find(render(), 'textarea').props.value, 'Private diagnosis');
});

const { WorkspaceNav } = load('src/components/navigation/workspace-nav.tsx', {
  '@/features/theme/theme-control': { ThemeControl: () => null },
  '@/features/notifications/notification-link': { NotificationLink: () => null },
  'next/navigation': { useRouter: () => ({ push() {} }), usePathname: () => '/app/tickets' },
  'next/link': { default: (props) => React.createElement('a', props) },
});
test('collapsed navigation retains explicit accessible names and current page', () => {
  const html = renderToStaticMarkup(React.createElement(WorkspaceNav, { role: 'administrator' }));
  for (const label of [
    'Dashboard',
    'Tickets',
    'Live chat',
    'People',
    'Settings',
    'Profile',
    'Security',
  ]) {
    assert.ok(html.includes(`aria-label="${label}"`));
  }
  assert.match(html, /aria-label="Tickets" title="Tickets" aria-current="page"/);
});
