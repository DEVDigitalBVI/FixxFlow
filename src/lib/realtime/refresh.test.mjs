import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from '../../../tests/helpers/load-module.mjs';

test('route refresh coalesces events, respects visibility, blocks overlapping transitions and cleans up', t => {
  const timeouts = new Map();
  const intervals = new Map();
  let id = 0;
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = document;
  globalThis.window = window;
  t.after(() => { globalThis.document = previousDocument; globalThis.window = previousWindow; });
  t.mock.method(globalThis, 'setTimeout', fn => { timeouts.set(++id, fn); return id; });
  t.mock.method(globalThis, 'clearTimeout', key => timeouts.delete(key));
  t.mock.method(globalThis, 'setInterval', fn => { intervals.set(++id, fn); return id; });
  t.mock.method(globalThis, 'clearInterval', key => intervals.delete(key));
  const effects = [];
  let refreshed = 0;
  const { useRouteRefresh } = load('src/lib/realtime/use-route-refresh.ts', {
    react: {
      useRef: current => ({ current }), useCallback: fn => fn,
      useEffect: fn => effects.push(fn), useTransition: () => [false, fn => fn()],
    },
    'next/navigation': { useRouter: () => ({ refresh: () => refreshed++ }) },
  });
  const refresh = useRouteRefresh();
  const cleanups = effects.map(fn => fn());
  refresh(); refresh(); window.dispatchEvent(new Event('focus'));
  assert.equal(timeouts.size, 1);
  const flush = () => { const callbacks = [...timeouts.values()]; timeouts.clear(); callbacks.forEach(fn => fn()); };
  flush();
  assert.equal(refreshed, 1);
  refresh();
  assert.equal(timeouts.size, 0, 'pending transition cannot overlap');
  effects[0](); // The transition completes and pending becomes false.
  document.visibilityState = 'hidden';
  for (const callback of intervals.values()) callback();
  assert.equal(timeouts.size, 0);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(timeouts.size, 1);
  flush();
  assert.equal(refreshed, 2);
  cleanups.forEach(fn => fn?.());
  assert.equal(intervals.size, 0);
  assert.equal(timeouts.size, 0);
  effects[0]();
  window.dispatchEvent(new Event('focus'));
  assert.equal(timeouts.size, 0);
});
