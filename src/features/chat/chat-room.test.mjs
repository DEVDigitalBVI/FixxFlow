import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

const message = (id, extra = {}) => ({
  id,
  organization_id: 'org',
  conversation_id: 'chat',
  author_id: 'other',
  kind: 'message',
  body: `Message ${id}`,
  created_at: '2026-10-17T12:00:00.000Z',
  ...extra,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ worker = false, insert, uploadResult, registerResult } = {}) {
  const events = [],
    sent = [],
    inserts = [],
    uploads = [],
    registrations = [],
    removed = [];
  let refreshes = 0;
  const channel = {
    on(type, filter, handler) {
      events.push({ type, filter, handler });
      return this;
    },
    subscribe(handler) {
      handler('SUBSCRIBED');
    },
    track() {},
    send(payload) {
      sent.push(payload);
    },
    presenceState: () => ({}),
  };
  const props = {
    conversationId: 'chat',
    organizationId: 'org',
    viewerId: 'viewer',
    isWorker: worker,
    open: true,
    names: {},
    initialMessages: [],
    attachments: [],
  };
  const h = componentHarness('src/features/chat/chat-room.tsx', 'ChatRoom', props, {
    '@/lib/supabase/client': {
      createClient: () => ({
        channel: () => channel,
        realtime: { setAuth: async () => {} },
        removeChannel() {},
        storage: {
          from: () => ({
            upload: async (path, file) => {
              uploads.push({ path, file });
              return typeof uploadResult === 'function'
                ? uploadResult()
                : (uploadResult ?? { error: null });
            },
            createSignedUrl: async () => ({
              data: { signedUrl: 'https://example.test/private-file' },
            }),
            remove: async (paths) => {
              removed.push(paths);
              return { error: null };
            },
          }),
        },
        from: (table) => ({
          insert(row) {
            if (table === 'chat_attachments') {
              registrations.push(row);
              return {
                select: () => ({
                  single: async () =>
                    registerResult ?? {
                      data: { ...row, id: 'file-1', created_at: '2026-10-17T12:01:00.000Z' },
                      error: null,
                    },
                }),
              };
            }
            inserts.push(row);
            return {
              select: () => ({
                single: () =>
                  insert
                    ? insert(row)
                    : Promise.resolve({
                        data: { ...row, created_at: '2026-10-17T12:00:00.000Z' },
                        error: null,
                      }),
              }),
            };
          },
          select: () => ({
            eq() {
              return this;
            },
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
    },
    '@/lib/realtime/use-route-refresh': {
      useRouteRefresh: () => () => {
        refreshes++;
      },
    },
    'next/navigation': {
      useRouter: () => ({
        refresh() {
          refreshes++;
        },
      }),
    },
    '@/components/ui/unsaved-changes': { useUnsavedChanges() {} },
  });
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.matchMedia = () => ({ matches: true });
  return {
    h,
    props,
    inserts,
    sent,
    uploads,
    registrations,
    removed,
    upload(file) {
      h.find((n) => n.type === 'input' && n.props.type === 'file').props.onChange({
        target: { files: [file], value: '' },
      });
      h.render();
    },
    refreshes: () => refreshes,
    receive(row) {
      events.find((e) => e.filter.table === 'chat_messages').handler({ new: row });
      h.render();
    },
    draft(value) {
      h.find((n) => n.type === 'textarea').props.onChange({ target: { value } });
      h.render();
    },
    submit() {
      return h.find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} });
    },
  };
}

test('live messages render immediately, deduplicate server refreshes and preserve history position', async () => {
  const f = fixture();
  try {
    await tick();
    const baseline = f.refreshes();
    f.receive(message('one'));
    assert.equal(f.h.all((n) => n.type === 'article').length, 1);
    assert.equal(f.refreshes(), baseline);
    const scrolls = f.h.scrolls.length;
    f.h
      .find((n) => n.props.role === 'log')
      .props.onScroll({ currentTarget: { scrollHeight: 1000, scrollTop: 100, clientHeight: 300 } });
    f.receive(message('two', { created_at: '2026-10-17T12:01:00.000Z' }));
    assert.equal(f.h.scrolls.length, scrolls);
    const button = f.h.find((n) => n.props.className === 'chat-new-messages');
    button.props.onClick();
    f.h.render();
    assert.equal(f.h.scrolls.at(-1).behavior, 'instant');
    f.props.initialMessages = [message('one'), message('two')];
    f.h.render();
    assert.equal(f.h.all((n) => n.type === 'article').length, 2);
  } finally {
    f.h.close();
  }
});

test('live event scope and employee internal-note visibility remain restricted', () => {
  const f = fixture();
  try {
    for (const row of [
      message('wrong-org', { organization_id: 'elsewhere' }),
      message('wrong-chat', { conversation_id: 'elsewhere' }),
      message('note', { kind: 'internal_note' }),
      message('invalid', { body: null }),
    ])
      f.receive(row);
    assert.equal(f.h.all((n) => n.type === 'article').length, 0);
  } finally {
    f.h.close();
  }
  const worker = fixture({ worker: true });
  try {
    worker.receive(message('note', { kind: 'internal_note' }));
    assert.equal(worker.h.all((n) => n.type === 'article').length, 1);
  } finally {
    worker.h.close();
  }
});

test('outgoing messages show progress, prevent duplicate sends and reconcile an early echo', async () => {
  let finish;
  const f = fixture({
    insert: (row) =>
      new Promise((resolve) => {
        finish = () =>
          resolve({ data: { ...row, created_at: '2026-10-17T12:00:00.000Z' }, error: null });
      }),
  });
  try {
    await tick();
    f.draft('Hello');
    const pending = f.submit();
    f.h.render();
    assert.equal(f.h.all((n) => n.type === 'article').length, 1);
    assert.ok(f.h.all((n) => n.type === 'small').some((n) => n.props.children === 'Sending…'));
    await f.submit();
    assert.equal(f.inserts.length, 1);
    f.receive(message(f.inserts[0].id, { author_id: 'viewer', body: 'Hello' }));
    finish();
    await pending;
    f.h.render();
    assert.equal(f.h.all((n) => n.type === 'article').length, 1);
    assert.equal(f.h.find((n) => n.type === 'textarea').props.value, '');
    assert.ok(f.sent.some((e) => e.payload.typing === false));
  } finally {
    f.h.close();
  }
});

test('typing the next message during a send keeps the newer draft', async () => {
  let finish;
  const f = fixture({
    insert: (row) =>
      new Promise((resolve) => {
        finish = () =>
          resolve({ data: { ...row, created_at: '2026-10-17T12:00:00.000Z' }, error: null });
      }),
  });
  try {
    f.draft('First message');
    const pending = f.submit();
    f.h.render();
    assert.equal(f.h.find((n) => n.type === 'textarea').props.disabled, undefined);
    f.draft('Next message');
    finish();
    await pending;
    f.h.render();
    assert.equal(f.h.find((n) => n.type === 'textarea').props.value, 'Next message');
  } finally {
    f.h.close();
  }
});

test('failed sends preserve drafts and reuse the same message ID on retry', async () => {
  let fail = true;
  const f = fixture({
    insert: async (row) =>
      fail
        ? { error: Error('offline'), data: null }
        : { data: { ...row, created_at: '2026-10-17T12:00:00.000Z' }, error: null },
  });
  try {
    f.draft('Keep my message');
    await f.submit();
    f.h.render();
    assert.equal(f.h.find((n) => n.type === 'textarea').props.value, 'Keep my message');
    assert.equal(f.h.all((n) => n.type === 'article').length, 0);
    assert.match(
      f.h.find((n) => n.props.className === 'chat-feedback').props.children,
      /try again/,
    );
    fail = false;
    await f.submit();
    f.h.render();
    assert.equal(f.inserts[0].id, f.inserts[1].id);
    assert.equal(f.h.all((n) => n.type === 'article').length, 1);
  } finally {
    f.h.close();
  }
});

test('Enter sends while Shift+Enter and IME composition retain native entry', () => {
  const f = fixture();
  try {
    const key = f.h.find((n) => n.type === 'textarea').props.onKeyDown;
    let sends = 0,
      prevented = 0;
    const event = {
      key: 'Enter',
      shiftKey: false,
      nativeEvent: { isComposing: false },
      preventDefault() {
        prevented++;
      },
      currentTarget: {
        form: {
          requestSubmit() {
            sends++;
          },
        },
      },
    };
    key({ ...event, shiftKey: true });
    key({ ...event, nativeEvent: { isComposing: true } });
    key({ ...event, keyCode: 229 });
    assert.equal(sends, 0);
    assert.equal(prevented, 0);
    key(event);
    assert.equal(sends, 1);
    assert.equal(prevented, 1);
  } finally {
    f.h.close();
  }
});

test('media uploads render in the thread with private links and prevent duplicate uploads', async () => {
  const f = fixture({ worker: true });
  try {
    f.h.find((n) => n.type === 'select').props.onChange({ target: { value: 'message' } });
    f.h.render();
    const file = new File(['video'], 'recording.mp4', { type: 'video/mp4' });
    f.upload(file);
    f.upload(file);
    await tick();
    f.h.render();
    assert.equal(f.uploads.length, 1);
    assert.equal(f.registrations.length, 1);
    assert.deepEqual(
      [
        f.registrations[0].organization_id,
        f.registrations[0].conversation_id,
        f.registrations[0].uploaded_by,
        f.registrations[0].content_type,
      ],
      ['org', 'chat', 'viewer', 'video/mp4'],
    );
    assert.equal(
      f.h.find((n) => n.props.file?.file_name === 'recording.mp4').props.file.url,
      'https://example.test/private-file',
    );
    assert.equal(f.removed.length, 0);
  } finally {
    f.h.close();
  }
});

test('failed media uploads retry the retained file and uncertain writes are never duplicated', async () => {
  let fail = true;
  const f = fixture({ uploadResult: () => ({ error: fail ? Error('offline') : null }) });
  try {
    const file = new File(['photo'], 'photo.png', { type: 'image/png' });
    f.upload(file);
    await tick();
    f.h.render();
    const retry = f.h.find((n) => n.props.className?.includes('chat-upload-retry'));
    assert.match(retry.props.children.join(''), /photo.png/);
    fail = false;
    retry.props.onClick();
    await tick();
    f.h.render();
    assert.equal(f.uploads[1].file, file);
    assert.equal(f.registrations.length, 1);
  } finally {
    f.h.close();
  }
  const uncertain = fixture({
    registerResult: { data: null, error: { code: '', message: 'lost response' } },
  });
  try {
    uncertain.upload(new File(['audio'], 'recording.mp3', { type: 'audio/mpeg' }));
    await tick();
    uncertain.h.render();
    assert.equal(uncertain.removed.length, 0);
    assert.equal(
      uncertain.h.all((n) => n.props.className?.includes('chat-upload-retry')).length,
      0,
    );
    assert.match(
      uncertain.h.find((n) => n.props.className === 'chat-feedback').props.children,
      /Refresh the file list/,
    );
  } finally {
    uncertain.h.close();
  }
});

test('compact composer keeps staff audiences explicit and preserves each draft when switching', () => {
  const f = fixture({ worker: true });
  try {
    f.draft('Private troubleshooting');
    assert.equal(
      f.h.find((n) => n.type === 'label' && n.props.htmlFor === 'chat-draft').props.children,
      'Internal note · IT only',
    );
    assert.equal(f.h.find((n) => n.type === 'textarea').props['aria-describedby'], 'chat-audience');
    f.h.find((n) => n.type === 'select').props.onChange({ target: { value: 'message' } });
    f.h.render();
    assert.equal(f.h.find((n) => n.type === 'textarea').props.value, '');
    f.draft('Public reply');
    f.h.find((n) => n.type === 'select').props.onChange({ target: { value: 'internal_note' } });
    f.h.render();
    assert.equal(f.h.find((n) => n.type === 'textarea').props.value, 'Private troubleshooting');
    assert.ok(f.h.find((n) => n.type === 'button' && n.props.children === 'Add internal note'));
  } finally {
    f.h.close();
  }
  const employee = fixture();
  try {
    assert.equal(employee.h.all((n) => n.type === 'select').length, 0);
    assert.equal(
      employee.h.find((n) => n.type === 'label' && n.props.htmlFor === 'chat-draft').props.children,
      'Message',
    );
    assert.equal(
      employee.h.find((n) => n.type === 'input' && n.props.type === 'file').props['aria-label'],
      'Attach a photo, video, audio or file',
    );
  } finally {
    employee.h.close();
  }
});

test('internal notes cannot carry attachments because chat files are shared with the employee', async () => {
  const f = fixture({ worker: true });
  try {
    const input = () => f.h.find((n) => n.type === 'input' && n.props.type === 'file');
    assert.equal(input().props.disabled, true);
    assert.equal(input().props['aria-describedby'], 'chat-audience');
    assert.match(
      f.h.find((n) => n.props.id === 'chat-audience').props.children.join(''),
      /Files are always shared with the employee/,
    );
    f.upload(new File(['photo'], 'photo.png', { type: 'image/png' }));
    await tick();
    assert.equal(f.uploads.length, 0);
    f.h.find((n) => n.type === 'select').props.onChange({ target: { value: 'message' } });
    f.h.render();
    assert.equal(input().props.disabled, false);
    assert.equal(input().props['aria-label'], 'Attach a file for the employee');
  } finally {
    f.h.close();
  }
});

test('files stay reachable from the compact toolbar without duplicating the attachment list', () => {
  const f = fixture();
  try {
    f.props.attachments = [
      {
        id: 'file',
        file_name: 'Screenshot.png',
        created_at: '2026-10-17T12:00:00Z',
        size_bytes: 100,
        storage_path: 'file',
        content_type: 'image/png',
      },
    ];
    f.props.open = false;
    f.h.render();
    assert.ok(f.h.find((n) => n.props.href === '/app/chat/chat/history?view=files'));
    assert.ok(f.h.find((n) => n.props.href === '/app/chat/chat/history'));
    assert.equal(f.h.all((n) => n.props.className === 'chat-attachments').length, 0);
    assert.equal(f.h.all((n) => n.type === 'form').length, 0);
  } finally {
    f.h.close();
  }
});
