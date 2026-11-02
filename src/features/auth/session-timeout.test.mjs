import assert from 'node:assert/strict';
import test from 'node:test';

import { load } from '../../../tests/helpers/load-module.mjs';

const { createSessionController, SESSION_WARNING_MS } = load(
  'src/features/auth/session-controller.ts',
);
function harness() {
  let now = 0,
    serverDeadline = 1800000,
    live = true,
    fail = false,
    actor = 'user';
  const calls = [],
    events = [];
  const controller = createSessionController({
    userId: 'user',
    now: () => now,
    request: async (active) => {
      calls.push(active);
      if (fail) throw Error('offline');
      if (now >= serverDeadline) live = false;
      if (active && live) serverDeadline = now + 1800000;
      return {
        active: live,
        user_id: actor,
        server_now: new Date(now + 9000000).toISOString(),
        idle_deadline: new Date(serverDeadline + 9000000).toISOString(),
      };
    },
    remaining: (n) => events.push(['remaining', n]),
    verified: () => events.push(['verified']),
    hide: () => events.push(['hide']),
    unavailable: () => events.push(['unavailable']),
    expired: () => events.push(['expired']),
    changed: () => events.push(['changed']),
    renewed: () => events.push(['renewed']),
  });
  return {
    controller,
    calls,
    events,
    time: (n) => {
      now = n;
    },
    extend: () => {
      serverDeadline = now + 1800000;
    },
    fail: () => {
      fail = true;
    },
    actor: (n) => {
      actor = n;
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test('passive checks do not renew sessions; the warning uses server time despite browser clock skew', async () => {
  const h = harness();
  await h.controller.check();
  for (let t = 30000; t <= 1680000; t += 30000) {
    h.time(t);
    h.controller.tick();
    await settle();
  }
  assert.ok(h.calls.every((active) => !active));
  assert.deepEqual(h.events.at(-2), ['remaining', SESSION_WARNING_MS]);
  h.time(1800000);
  h.controller.tick();
  await settle();
  assert.ok(h.events.some((e) => e[0] === 'expired'));
});
test('genuine activity is throttled; explicit Stay signed in renews before expiry', async () => {
  const h = harness();
  await h.controller.check();
  h.time(1000);
  h.controller.activity();
  await settle();
  h.time(2000);
  h.controller.activity();
  await settle();
  assert.equal(h.calls.filter(Boolean).length, 1);
  h.time(31000);
  h.controller.tick();
  await settle();
  assert.equal(h.calls.filter(Boolean).length, 2);
  h.time(1711000);
  await h.controller.check();
  h.controller.activity();
  await settle();
  assert.equal(h.calls.filter(Boolean).length, 2, 'warning interactions require explicit renewal');
  await h.controller.check(true);
  assert.equal(h.calls.filter(Boolean).length, 3);
  assert.deepEqual(h.events.at(-2), ['remaining', 1800000]);
});
test('an expired local countdown rechecks another tab’s server activity before signing out', async () => {
  const h = harness();
  await h.controller.check();
  h.time(1790000);
  h.extend();
  h.time(1800000);
  h.controller.tick();
  await settle();
  assert.ok(h.events.some((e) => e[0] === 'hide'));
  assert.ok(!h.events.some((e) => e[0] === 'expired'));
  assert.deepEqual(h.events.at(-1), ['verified']);
});
test('expired sessions cannot renew; failures hide private content and account switches reload without revoking the new user', async () => {
  const h = harness();
  await h.controller.check();
  h.time(1800001);
  await h.controller.check(true);
  assert.ok(h.events.some((e) => e[0] === 'expired'));
  const offline = harness();
  offline.fail();
  await offline.controller.check();
  assert.deepEqual(offline.events, [['hide'], ['unavailable']]);
  const changed = harness();
  changed.actor('other');
  await changed.controller.check();
  assert.deepEqual(changed.events, [['hide'], ['changed']]);
});

test('heartbeat endpoint rejects cross-origin requests; polling only reads session state', async () => {
  const calls = [];
  const { GET, POST } = load('src/app/(auth)/auth/session/route.ts', {
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name) => {
          calls.push(name);
          return { data: { active: true, user_id: 'user' }, error: null };
        },
      }),
    },
    '@/lib/server-errors': { reportServerError: () => {} },
  });
  assert.equal((await GET()).status, 200);
  assert.deepEqual(calls, ['app_session_state']);
  const request = (origin) =>
    new Request('https://fixxflow.com/auth/session', {
      method: 'POST',
      headers: origin ? { origin } : {},
    });
  assert.equal((await POST(request('https://other.example'))).status, 403);
  assert.equal((await POST(request())).status, 403);
  assert.equal(calls.length, 1);
  assert.equal((await POST(request('https://fixxflow.com'))).status, 200);
  assert.deepEqual(calls, ['app_session_state', 'touch_app_session']);
});
test('warning offers a focused primary renewal action, named dialog and quiet countdown', async () => {
  const { componentHarness } = await import('../../../tests/helpers/component-harness.mjs');
  let stays = 0,
    exits = 0;
  const h = componentHarness(
    'src/features/auth/session-warning.tsx',
    'SessionWarning',
    { remaining: 91000, onStay: () => stays++, onSignOut: () => exits++ },
    {
      '@/components/ui/dialog': {
        Dialog: 'dialog-root',
        DialogContent: 'dialog-content',
        DialogTitle: 'h2',
      },
    },
  );
  try {
    const stay = h.find((n) => n.type === 'button' && n.props.children === 'Stay signed in');
    assert.equal(stay.props.variant, 'primary');
    assert.equal(stay.props.autoFocus, true);
    stay.props.onClick();
    assert.equal(stays, 1);
    h.find((n) => n.type === 'button' && n.props.children === 'Sign out').props.onClick();
    assert.equal(exits, 1);
    assert.equal(h.find((n) => n.props.role === 'timer').props['aria-live'], 'off');
    assert.equal(
      h.find((n) => n.type === 'dialog-content').props['aria-describedby'],
      'session-warning-description',
    );
    h.find((n) => n.type === 'dialog-root').props.onOpenChange(false);
    assert.equal(
      stays,
      2,
      'Escape keeps the session active rather than silently dismissing its deadline',
    );
  } finally {
    h.close();
  }
});
