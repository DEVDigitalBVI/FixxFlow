import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';

function setup(role) {
  const calls = [];
  const query = new Proxy({}, {
    get: (_, key) => key === 'then'
      ? resolve => Promise.resolve({ data: [], error: null }).then(resolve)
      : (...args) => { calls.push([key, ...args]); return query; },
  });
  const { default: Page } = load('src/app/app/chat/page.tsx', {
    'next/link': { default: props => React.createElement('a', props) },
    '@/components/ui/submit-button': { SubmitButton: props => { const buttonProps = { ...props }; delete buttonProps.pendingLabel; return React.createElement('button', buttonProps); } },
    '@/features/chat/live-queue': { LiveChatQueue: () => null },
    '@/app/app/chat/actions': { startChat: async () => {} },
    '@/lib/auth/viewer': { requireViewer: async () => ({ role, id: 'viewer', organizationId: 'org' }) },
    '@/lib/supabase/server': { createClient: async () => {
      calls.push(['client']);
      return { from: table => { calls.push(['from', table]); return query; } };
    } },
  });
  return { calls, render: async params => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) })) };
}

test('chat intake and recoverable errors do not load the queue', async () => {
  for (const params of [{ start: '1' }, { error: 'Try again' }]) {
    const { calls, render } = setup('technician');
    const html = await render(params);
    assert.match(html, /<h1>Start a chat<\/h1>/);
    assert.match(html, /htmlFor=|for="chat-topic"/);
    assert.deepEqual(calls, []);
  }
});

test('employee chat lists skip staff names and retain requester scoping', async () => {
  const { calls, render } = setup('end_user');
  assert.match(await render({}), /My chats/);
  assert.deepEqual(calls.filter(call => call[0] === 'from'), [['from', 'chat_conversations']]);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'requester_id' && call[2] === 'viewer'));
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'organization_id' && call[2] === 'org'));
});

test('empty staff queues skip name lookups and apply assignment filters', async () => {
  const { calls, render } = setup('technician');
  await render({ view: 'mine' });
  assert.equal(calls.some(call => call[0] === 'from' && call[1] === 'profiles'), false);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'assigned_technician_id' && call[2] === 'viewer'));
});
