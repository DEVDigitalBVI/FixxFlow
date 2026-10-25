import assert from 'node:assert/strict';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const chat = {
  id: 'chat-1',
  topic: 'VPN access',
  requester_id: 'employee',
  assigned_technician_id: 'worker',
  status: 'open',
  ticket_id: null,
  updated_at: '2026-10-17T12:00:00Z',
  chat_messages: [{ body: 'Please help with <VPN>', author_id: 'employee' }],
  notifications: [{ count: 2 }],
};

test('inbox fetch bounds previews and scopes unread counts to the viewer', async () => {
  const requests = [];
  const db = createClient('https://example.test', 'test-key', {
    auth: { persistSession: false },
    global: {
      fetch: async (url) => {
        requests.push(new URL(url));
        return Response.json([chat]);
      },
    },
  });
  const { loadChatInbox } = load('src/features/chat/inbox-data.ts', {
    '@/features/lookups/labels': { profileLabels: async () => [] },
  });
  const result = await loadChatInbox(
    db,
    { id: 'employee', organizationId: 'org', role: 'end_user' },
    'all',
  );
  assert.equal(result.chats[0].unread, 2);
  assert.equal(result.chats[0].preview.body, 'Please help with <VPN>');
  assert.equal(result.failed, false);
  const params = requests[0].searchParams;
  for (const [key, value] of Object.entries({
    organization_id: 'eq.org',
    requester_id: 'eq.employee',
    'chat_messages.kind': 'eq.message',
    'chat_messages.limit': '1',
    'notifications.recipient_id': 'eq.employee',
    'notifications.read_at': 'is.null',
    limit: '100',
  }))
    assert.equal(params.get(key), value, key);
  assert.match(params.get('chat_messages.order'), /created_at.desc,id.desc/);
  assert.match(params.get('select'), /notifications\(count\)/);
});

test('inbox failures remain errors and do not load unrelated profile data', async () => {
  let profileCalls = 0;
  const { loadChatInbox } = load('src/features/chat/inbox-data.ts', {
    '@/features/lookups/labels': {
      profileLabels: async () => {
        profileCalls++;
        return [];
      },
    },
  });
  const db = createClient('https://example.test', 'test-key', {
    auth: { persistSession: false },
    global: { fetch: async () => Response.json({ message: 'unavailable' }, { status: 400 }) },
  });
  const result = await loadChatInbox(
    db,
    { id: 'worker', organizationId: 'org', role: 'technician' },
    'mine',
  );
  assert.equal(result.failed, true);
  assert.deepEqual(result.chats, []);
  assert.equal(profileCalls, 0);
});

test('inbox links preserve selection and filters and expose unread updates without color', () => {
  const { ChatInbox } = load('src/features/chat/chat-inbox.tsx', {
    'next/link': {
      default: (props) => {
        const attributes = { ...props };
        delete attributes.scroll;
        return React.createElement('a', attributes);
      },
    },
    './live-queue': { LiveChatQueue: () => null },
  });
  const html = renderToStaticMarkup(
    React.createElement(ChatInbox, {
      chats: [{ ...chat, preview: chat.chat_messages[0], unread: 2 }],
      names: new Map([
        ['employee', 'Jordan'],
        ['worker', 'Alex'],
      ]),
      view: 'mine',
      organizationId: 'org',
      viewerId: 'worker',
      selectedId: 'chat-1',
    }),
  );
  assert.match(
    html,
    /href="\/app\/chat\/chat-1\?view=mine" aria-current="page" aria-label="Open chat: VPN access, 2 unread updates"/,
  );
  assert.match(html, /Please help with &lt;VPN&gt;/);
  assert.match(html, /Assigned to Alex/);
  assert.match(html, /href="\/app\/chat\/chat-1\?view=unassigned"/);
  const personal = renderToStaticMarkup(
    React.createElement(ChatInbox, {
      chats: [chat],
      names: new Map(),
      view: 'open',
      organizationId: 'org',
      viewerId: 'employee',
      personal: true,
    }),
  );
  assert.doesNotMatch(personal, /Chat views|Assigned to|Unassigned/);
  assert.match(personal, /IT support/);
});
