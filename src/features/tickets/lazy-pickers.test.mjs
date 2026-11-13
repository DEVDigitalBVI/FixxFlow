import assert from 'node:assert/strict';
import test from 'node:test';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';

const tick = () => new Promise(setImmediate);

test('saved replies load only on first open, show loading/error/retry, and insert without losing the draft', async () => {
  const previous = {
    fetch: globalThis.fetch,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  let calls = 0,
    resolve,
    inserted;
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.fetch = () => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const h = componentHarness('src/features/tickets/saved-reply-picker.tsx', 'SavedReplyPicker', {
    lazy: true,
    context: { requesterName: 'Alex' },
    onInsert: (text) => {
      inserted = text;
    },
  });
  try {
    assert.equal(calls, 0);
    const open = () =>
      h.find((n) => n.type === 'details').props.onToggle({ currentTarget: { open: true } });
    open();
    h.render();
    assert.equal(calls, 1);
    assert.ok(h.find((n) => n.props.role === 'status'));
    resolve(new Response('', { status: 503 }));
    await tick();
    h.render();
    assert.ok(h.find((n) => n.type === 'button' && n.props.children === 'Retry saved replies'));
    const retry = h
      .find((n) => n.type === 'button' && n.props.children === 'Retry saved replies')
      .props.onClick();
    h.render();
    resolve(
      Response.json({
        items: [{ id: 'one', title: 'Reconnect', body: 'Hi {{requester_name}}, reconnect.' }],
      }),
    );
    await retry;
    h.render();
    h.find((n) => n.props.type === 'search').props.onChange({ target: { value: 'reconnect' } });
    h.render();
    const choice = h.find(
      (n) => n.type === 'button' && n.props.onClick && n.props.children !== 'Retry saved replies',
    );
    choice.props.onClick();
    assert.equal(inserted, 'Hi Alex, reconnect.');
    open();
    await tick();
    assert.equal(calls, 2, 'successful choices stay cached for this mounted picker');
  } finally {
    h.close();
    Object.assign(globalThis, previous);
  }
});

test('closing/unmounting a lazy picker cancels obsolete requests and invalid payloads are retryable', async () => {
  const original = globalThis.fetch;
  let signal, resolve;
  globalThis.fetch = (_url, options) => {
    signal = options.signal;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const h = componentHarness('src/features/tickets/saved-reply-picker.tsx', 'SavedReplyPicker', {
    lazy: true,
    context: {},
    onInsert() {},
  });
  try {
    h.find((n) => n.type === 'details').props.onToggle({ currentTarget: { open: true } });
    h.close();
    assert.equal(signal.aborted, true);
    resolve(Response.json({ items: [] }));
    await tick();
  } finally {
    globalThis.fetch = original;
  }
});

test('tag suggestions load on field focus, keep manual entry enabled after failures and retry', async () => {
  const original = globalThis.fetch;
  let calls = 0,
    resolve;
  globalThis.fetch = () => {
    calls++;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const h = componentHarness('src/features/tickets/tag-suggestions.tsx', 'TagSuggestions', {
    ticketId: 'ticket',
    tags: ['already'],
  });
  try {
    assert.equal(calls, 0);
    h.find((n) => n.type === 'input').props.onFocus();
    h.render();
    assert.equal(calls, 1);
    assert.equal(h.find((n) => n.type === 'input').props.disabled, undefined);
    resolve(Response.json({ items: 'invalid' }));
    await tick();
    h.render();
    const retry = h
      .find((n) => n.type === 'button' && n.props.children === 'Retry suggestions')
      .props.onClick();
    h.render();
    resolve(Response.json({ items: ['already', 'vpn'] }));
    await retry;
    h.render();
    assert.deepEqual(
      h.all((n) => n.type === 'option').map((n) => n.props.value),
      ['vpn'],
    );
    h.find((n) => n.type === 'input').props.onFocus();
    await tick();
    assert.equal(calls, 2);
  } finally {
    h.close();
    globalThis.fetch = original;
  }
});
