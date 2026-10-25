import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

async function render({ assigned = null, messages = [] } = {}) {
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
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ id: 'employee', role: 'end_user', organizationId: 'org' }),
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
  assert.match(html, /Your assigned technician/);
  assert.equal(room.participantId, 'technician');
  assert.equal(room.supportName, 'Casey Robinson');
});

test('unassigned chats explain the team inbox and identify the last support responder when available', async () => {
  const waiting = await render();
  assert.match(waiting.html, /Chatting with IT support team/);
  assert.match(waiting.html, /technician has not picked it up yet/);
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
  assert.doesNotMatch(replied.html, /not picked it up/);
});
