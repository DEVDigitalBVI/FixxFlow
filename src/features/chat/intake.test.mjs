import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';

function actionSetup(result = { data: 'chat-id', error: null }) {
 const calls = [];
 const { startChat } = load('src/app/app/chat/actions.ts', {
  'next/cache': { revalidatePath: path => calls.push(['revalidate', path]) },
  'next/navigation': { redirect: path => { throw Error(`REDIRECT:${path}`); } },
  '@/lib/auth/viewer': { requireViewer: async () => { calls.push(['viewer']); return { organizationId: 'trusted-org' }; } },
  '@/lib/supabase/server': { createClient: async () => ({ rpc: async (...args) => { calls.push(['rpc', ...args]); return result; } }) },
 });
 const form = (topic, message) => { const data = new FormData(); data.set('submissionKey','90000000-0000-4000-8000-000000000001'); data.set('topic', topic); data.set('message', message); data.set('organizationId', 'other-org'); return data; };
 return { calls, submit: (topic, message) => startChat({}, form(topic, message)) };
}

test('chat intake validates trimmed fields without writes and returns field-level feedback', async () => {
 const { calls, submit } = actionSetup();
 const state = await submit('  ', ' ');
 assert.match(state.fields.topic, /3 and 180/);
 assert.match(state.fields.message, /20,000/);
 assert.deepEqual(calls, [['viewer']]);
 for (const [topic, message, field] of [['x'.repeat(181), 'valid', 'topic'], ['valid', 'x'.repeat(20001), 'message']]) {
  assert.ok((await submit(topic, message)).fields[field]);
 }
 assert.equal(calls.filter(call => call[0] === 'rpc').length, 0);
});

test('chat creation preserves trusted organization context and redirects only on success', async () => {
 const { calls, submit } = actionSetup();
 await assert.rejects(submit(' VPN problem ', ' Cannot connect '), /REDIRECT:\/app\/chat\/chat-id/);
 assert.deepEqual(calls, [['viewer'], ['rpc', 'submit_support_request', { org: 'trusted-org', token: '90000000-0000-4000-8000-000000000001', kind: 'chat', payload: { topic: 'VPN problem', message: 'Cannot connect' } }], ['revalidate', '/app/chat']]);
});

test('chat creation failure returns safe retry feedback instead of discarding the form through a redirect', async () => {
 for (const result of [{ data: null, error: { message: 'sensitive backend detail' } }, { data: null, error: null }]) {
  const { calls, submit } = actionSetup(result);
  const state = await submit('VPN problem', 'Cannot connect');
  assert.match(state.error, /Your message is still here/);
  assert.doesNotMatch(state.error, /sensitive/);
  assert.equal(calls.some(call => call[0] === 'revalidate'), false);
 }
});

test('chat form preserves controlled drafts on errors, associates feedback, focuses errors and shows pending state', () => {
 for (const pending of [false, true]) {
  let focusCount = 0;
  let stateIndex = 0;
  const drafts = ['VPN problem', 'First line\nSecond line'];
  const { StartChatForm } = load('src/features/chat/start-chat-form.tsx', {
   react: { ...React, useActionState: () => [{ error: 'Try again', fields: { topic: 'Check subject', message: 'Check message' } }, () => {}, pending], useState: () => [drafts[stateIndex++], () => {}], useRef: () => ({ current: { focus: () => focusCount++ } }), useEffect: fn => fn() },
   'next/link': { default: props => React.createElement('a', props) },
   '@/app/app/chat/actions': { startChat: () => {} },
   '@/components/ui/submit-button': { SubmitButton: ({ pendingLabel, ...props }) => React.createElement('button', props, props.disabled ? pendingLabel : props.children) },
  });
  const html = renderToStaticMarkup(React.createElement(StartChatForm));
  assert.match(html, /value="VPN problem"/); assert.match(html, /First line\nSecond line/);
  assert.match(html, /aria-describedby="chat-topic-error"/); assert.match(html, /aria-describedby="chat-message-hint chat-message-error"/);
  assert.match(html, /aria-invalid="true"/); assert.match(html, /role="alert" tabindex="-1"/);
  assert.match(html, /Enter adds a new line/); assert.match(html, /href="\/app\/chat">Cancel/);
  assert.equal(focusCount, 1);
  if (pending) { assert.match(html, /aria-busy="true"/); assert.match(html, /disabled=""/); assert.match(html, /Starting chat…/); }
 }
});

const queue = props => {
 const { ChatQueue } = load('src/features/chat/chat-queue.tsx', { 'next/link': { default: props => React.createElement('a', props) } });
 return renderToStaticMarkup(React.createElement(ChatQueue, { chats: [], names: new Map(), view: 'open', failed: false, ...props }));
};
test('chat queue empty views provide relevant next steps; load errors do not pretend the queue is empty', () => {
 assert.match(queue({}), /Ready for the next conversation/);
 assert.match(queue({ view: 'mine' }), /href="\/app\/chat\?view=unassigned">View unassigned chats/);
 assert.match(queue({ view: 'unassigned' }), /No chats waiting for an owner/);
 assert.match(queue({ view: 'all' }), /No conversations yet/);
 const error = queue({ view: 'mine', failed: true });
 assert.match(error, /role="alert"/); assert.match(error, /href="\/app\/chat\?view=mine">Try again/);
 assert.doesNotMatch(error, /0 conversations|no assigned chats/);
});

test('chat rows show ownership, written status, exact timestamps and uniquely named open buttons', () => {
 const chat = { id: 'c1', topic: 'VPN access', requester_id: 'r1', assigned_technician_id: 't1', status: 'closed', ticket_id: 'ticket1', updated_at: '2026-10-01T12:00:00Z' };
 const html = queue({ chats: [chat], names: new Map([['r1', 'Robin'], ['t1', 'Alex']]), view: 'all' });
 for (const text of ['VPN access', 'Robin', 'Assigned to Alex', 'Closed', 'Linked to a ticket']) assert.ok(html.includes(text));
 assert.match(html, /class="button button-secondary" href="\/app\/chat\/c1" aria-label="Open chat: VPN access"/);
 assert.match(html, /<time dateTime="2026-10-01T12:00:00Z"/i);
 assert.match(queue({ chats: Array.from({ length: 100 }, (_, i) => ({ ...chat, id: `c${i}` })) }), /Latest 100 conversations/);
});
