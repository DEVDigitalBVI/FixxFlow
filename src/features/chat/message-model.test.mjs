import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { buildChatTimeline } = load('src/features/chat/message-model.ts');
const { HISTORY_PAGE_SIZE } = load('src/features/conversations/history.ts');
const message = (id, extra = {}) => ({
  id,
  author_id: 'staff',
  kind: 'message',
  body: id,
  created_at: '2026-11-12T12:00:00Z',
  ...extra,
});
const build = (extra = {}) =>
  buildChatTimeline({
    liveMessages: [],
    initialMessages: [],
    outgoing: null,
    liveAttachments: [],
    initialAttachments: [],
    ...extra,
  });
test('chat timeline orders tied messages and files deterministically', () => {
  const result = build({
    initialMessages: [message('b'), message('a')],
    initialAttachments: [{ id: 'z', created_at: message('').created_at }],
  });
  assert.deepEqual(
    result.timeline.map((row) => row.key),
    ['file:z', 'message:a', 'message:b'],
  );
});
test('confirmed messages replace optimistic echoes and preserve newer live edits', () => {
  const result = build({
    initialMessages: [message('a', { revision: 1 })],
    liveMessages: [message('a', { revision: 2, body: 'edited' })],
    outgoing: message('a'),
  });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].body, 'edited');
  assert.equal(result.confirmed.size, 1);
});
test('chat history trims confirmed rows while retaining the pending message', () => {
  const result = build({
    initialMessages: Array.from({ length: HISTORY_PAGE_SIZE + 5 }, (_, i) =>
      message(String(i).padStart(4, '0')),
    ),
    outgoing: message('pending'),
  });
  assert.equal(result.messages.length, HISTORY_PAGE_SIZE + 1);
  assert.equal(result.messages[0].id, '0005');
  assert.equal(result.messages.at(-1).id, 'pending');
});
