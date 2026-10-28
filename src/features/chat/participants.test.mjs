import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

async function render({ assigned = null, messages = [], role = 'end_user' } = {}) {
  let room;
  const conversation = {
    id: 'chat',
    organization_id: 'org',
    topic: 'VPN',
    requester_id: 'employee',
    assigned_technician_id: assigned,
    status: 'open',
    ticket_id: null,
  };
  const query = (table) =>
    new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'maybeSingle'
            ? async () => ({ data: conversation, error: null })
            : key === 'then'
              ? (resolve) =>
                  Promise.resolve({
                    data: table === 'chat_messages' ? messages : [],
                    error: null,
                  }).then(resolve)
              : () => query(table),
      },
    );
  const { default: Page } = load('src/app/app/chat/[conversationId]/page.tsx', {
    'next/link': { default: (props) => React.createElement('a', props) },
    'next/navigation': {
      notFound() {
        throw new Error('not found');
      },
      useRouter: () => ({ refresh() {}, push() {} }),
      usePathname: () => '/app/chat/chat',
      useSearchParams: () => new URLSearchParams(),
    },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({
        id: role === 'end_user' ? 'employee' : 'worker',
        role,
        organizationId: 'org',
      }),
    },
    '@/lib/supabase/server': { createClient: async () => ({ from: query }) },
    '@/features/lookups/labels': {
      profileLabels: async () => [{ user_id: 'technician', display_name: 'Casey Robinson' }],
    },
    '@/features/chat/inbox-data': { loadChatInbox: async () => ({}) },
    '@/features/chat/chat-center': {
      ChatCenter: ({ children }) => React.createElement('div', null, children),
    },
    '@/features/chat/chat-room': {
      ChatRoom: (props) => {
        room = props;
        return null;
      },
    },
  });
  return {
    html: renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ conversationId: 'chat' }),
        searchParams: Promise.resolve({}),
      }),
    ),
    room,
  };
}

test('employees see their assigned technician rather than an unnamed participant', async () => {
  const { html, room } = await render({ assigned: 'technician' });
  assert.match(html, /Chatting with Casey Robinson/);
  assert.doesNotMatch(html, /Waiting for a technician/, 'no repeated identity line once assigned');
  assert.equal(room.participantId, 'technician');
  assert.equal(room.supportName, 'Casey Robinson');
});

test('unassigned chats explain the team inbox and identify the last support responder when available', async () => {
  const waiting = await render();
  assert.match(waiting.html, /Chatting with IT support team/);
  assert.match(waiting.html, /Waiting for a technician to pick this up/);
  const replied = await render({
    messages: [
      {
        id: 'reply',
        author_id: 'technician',
        kind: 'message',
        body: 'I can help',
        created_at: '2026-10-17T12:01:00Z',
      },
    ],
  });
  assert.match(replied.html, /Chatting with Casey Robinson/);
  assert.match(replied.html, /Last replied by Casey Robinson/);
  assert.doesNotMatch(replied.html, /Waiting for a technician/);
});

test('staff see the chat owner beside the heading and can take unassigned chats', async () => {
  const unassigned = await render({ role: 'technician' });
  assert.match(unassigned.html, /Owner: Unassigned/);
  assert.match(unassigned.html, /name="assigneeId" value="worker"/);
  assert.match(unassigned.html, /Assign to me/);
  const owned = await render({ role: 'technician', assigned: 'technician' });
  assert.match(owned.html, /Owner: Casey Robinson/);
  assert.doesNotMatch(owned.html, /Assign to me/);
});
