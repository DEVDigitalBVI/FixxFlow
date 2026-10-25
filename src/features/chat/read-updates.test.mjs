import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture({ active = true, result = { data: [{ id: 'notice' }], error: null } } = {}) {
  const calls = [],
    events = [],
    listeners = new Map();
  let response = result;
  const query = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then'
          ? (resolve) => Promise.resolve(response).then(resolve)
          : (...args) => {
              calls.push([key, ...args]);
              return query;
            },
    },
  );
  const props = {
    conversationId: 'chat',
    organizationId: 'org',
    viewerId: 'viewer',
    through: '2026-10-17T12:00:00Z',
    active,
  };
  let refreshes = 0;
  const refresh = () => {
    refreshes++;
  };
  const h = componentHarness('src/features/chat/read-updates.tsx', 'ChatReadUpdates', props, {
    '@/lib/supabase/client': {
      createClient: () => ({
        from: (table) => {
          calls.push(['from', table]);
          return query;
        },
      }),
    },
    '@/lib/realtime/use-route-refresh': { useRouteRefresh: () => refresh },
  });
  window.dispatchEvent = (event) => events.push(event.type);
  document.addEventListener = (name, fn) => listeners.set(name, fn);
  document.removeEventListener = () => {};
  document.visibilityState = 'visible';
  // The first effect starts while the harness document has no visibility value.
  props.through = '2026-10-17T12:00:01Z';
  h.render();
  return {
    h,
    props,
    calls,
    events,
    listeners,
    refreshes: () => refreshes,
    setResult(value) {
      response = value;
    },
  };
}

test('visible chats acknowledge only the viewer and loaded snapshot and update notification counts', async () => {
  const f = fixture();
  try {
    await tick();
    for (const call of [
      ['from', 'notifications'],
      ['eq', 'organization_id', 'org'],
      ['eq', 'recipient_id', 'viewer'],
      ['eq', 'conversation_id', 'chat'],
      ['is', 'read_at', null],
      ['lte', 'created_at', f.props.through],
    ])
      assert.ok(
        f.calls.some((value) => JSON.stringify(value) === JSON.stringify(call)),
        JSON.stringify(call),
      );
    assert.deepEqual(f.events, ['notifications-changed']);
    assert.equal(f.refreshes(), 1);
  } finally {
    f.h.close();
  }
});

test('history reading and background tabs keep unread updates untouched', async () => {
  const f = fixture({ active: false });
  try {
    await tick();
    assert.equal(f.calls.length, 0);
    document.visibilityState = 'hidden';
    f.props.active = true;
    f.h.render();
    await tick();
    assert.equal(f.calls.length, 0);
    document.visibilityState = 'visible';
    f.listeners.get('visibilitychange')();
    await tick();
    assert.ok(f.calls.length > 0);
  } finally {
    f.h.close();
  }
});

test('failed acknowledgements expose retry without pretending updates were read', async () => {
  const f = fixture({ result: { data: null, error: Error('unavailable') } });
  try {
    await tick();
    f.h.render();
    assert.equal(f.events.length, 0);
    f.setResult({ data: [{ id: 'notice' }], error: null });
    f.h.find((n) => n.type === 'button').props.onClick();
    f.h.render();
    await tick();
    f.h.render();
    assert.deepEqual(f.events, ['notifications-changed']);
    assert.equal(f.h.all((n) => n.type === 'button').length, 0);
  } finally {
    f.h.close();
  }
});
