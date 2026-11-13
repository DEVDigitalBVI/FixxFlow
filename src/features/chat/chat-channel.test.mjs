import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
test('chat removes the previous channel on conversation change and on unmount', async () => {
  const channels = [],
    removed = [],
    refresh = () => {};
  const client = {
    realtime: { setAuth: async () => {} },
    channel(name) {
      const channel = {
        name,
        events: [],
        on(type, filter, handler) {
          this.events.push({ type, filter, handler });
          return this;
        },
        subscribe(fn) {
          fn('SUBSCRIBED');
        },
        track() {},
        presenceState: () => ({}),
        send() {},
      };
      channels.push(channel);
      return channel;
    },
    removeChannel(channel) {
      removed.push(channel);
    },
  };
  const props = {
    conversationId: 'one',
    organizationId: 'org',
    viewerId: 'viewer',
    isWorker: true,
    open: true,
    names: {},
    initialMessages: [],
    attachments: [],
  };
  const h = componentHarness('src/features/chat/chat-room.tsx', 'ChatRoom', props, {
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/realtime/use-route-refresh': { useRouteRefresh: () => refresh },
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
  });
  try {
    await tick();
    props.conversationId = 'two';
    h.render();
    await tick();
    assert.deepEqual(
      channels.map((channel) => channel.name),
      ['chat:one', 'chat:two'],
    );
    assert.deepEqual(removed, [channels[0]]);
    channels[0].events
      .find((event) => event.filter.table === 'chat_messages')
      .handler({
        new: {
          id: 'late',
          organization_id: 'org',
          conversation_id: 'one',
          author_id: 'other',
          kind: 'message',
          body: 'late echo',
          created_at: '2026-11-12T12:00:00Z',
        },
      });
    h.render();
    assert.equal(h.all((node) => node.props.children === 'late echo').length, 0);
  } finally {
    h.close();
  }
  assert.deepEqual(removed, channels);
});
