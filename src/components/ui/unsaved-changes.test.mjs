import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';

import { load } from '../../../tests/helpers/load-module.mjs';

function fixture() {
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
  };
  const listeners = {},
    cleanups = [],
    moves = [];
  let prompts = 0,
    answer = false;
  const win = {
    location: { href: 'https://example.test/app/tickets/new' },
    confirm: () => {
      prompts++;
      return answer;
    },
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    removeEventListener: (name) => {
      delete listeners[name];
    },
  };
  win.history = {
    state: { __NA: true },
    pushState(state, _, url) {
      this.state = state;
      if (url) win.location.href = new URL(url, win.location.href).href;
    },
    replaceState(state, _, url) {
      this.state = state;
      if (url) win.location.href = new URL(url, win.location.href).href;
    },
    go: (n) => moves.push(n),
  };
  globalThis.window = win;
  globalThis.document = {
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    removeEventListener: (name) => {
      delete listeners[name];
    },
  };
  globalThis.Element = class {};
  const hooks = {
    ...React,
    useRef: (value) => ({ current: value }),
    useEffect: (fn) => {
      const cleanup = fn();
      if (cleanup) cleanups.push(cleanup);
    },
  };
  const draftGuard = load('src/components/ui/unsaved-changes.ts', { react: hooks });
  const release = draftGuard.useUnsavedChanges(true);
  return {
    ...draftGuard,
    win,
    listeners,
    moves,
    release,
    prompts: () => prompts,
    answer: (value) => {
      answer = value;
    },
    click(href, props = {}) {
      const link = { href, target: '', download: '', focus() {} };
      const target = new globalThis.Element();
      target.closest = () => link;
      const event = {
        target,
        button: 0,
        preventDefault() {
          this.prevented = true;
        },
        stopImmediatePropagation() {
          this.stopped = true;
        },
        ...props,
      };
      listeners.click(event);
      return event;
    },
    close() {
      cleanups.reverse().forEach((fn) => fn());
      Object.assign(globalThis, old);
    },
  };
}
test('dirty navigation is declined before link handlers; anchors, modified clicks and new tabs stay native', () => {
  const f = fixture();
  try {
    assert.equal(f.click('/app/help').prevented, true);
    assert.equal(f.prompts(), 1);
    assert.equal(f.click('#details').prevented, undefined);
    assert.equal(f.click('/app/help', { metaKey: true }).prevented, undefined);
    assert.equal(f.prompts(), 1);
    assert.equal(f.leavesDocument('/app/tickets/new#details', f.win.location.href), false);
    assert.equal(f.leavesDocument('/app/tickets/new?mode=other', f.win.location.href), true);
  } finally {
    f.close();
  }
});
test('confirmed navigation produces one prompt and successful saves release reload protection', () => {
  const f = fixture();
  try {
    f.answer(true);
    assert.equal(f.click('/app/help').prevented, undefined);
    assert.equal(f.confirmDiscardChanges(), true);
    assert.equal(f.prompts(), 1);
    f.release();
    let prevented = false;
    f.listeners.beforeunload({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, false);
  } finally {
    f.close();
  }
});
test('declined Back restores history before the router receives the event and preserves router metadata', () => {
  const f = fixture();
  try {
    f.win.history.pushState({ __NA: true, tree: 'next-router' }, '', '/app/tickets/new?draft=1');
    assert.equal(f.win.history.state.tree, 'next-router');
    f.win.location.href = 'https://example.test/app/tickets/new';
    let stopped = false;
    f.listeners.popstate({
      state: { fixxflowEntry: 0 },
      stopImmediatePropagation() {
        stopped = true;
      },
    });
    assert.equal(stopped, true);
    assert.deepEqual(f.moves, [1]);
    let restoredStopped = false;
    f.listeners.popstate({
      state: { fixxflowEntry: 1 },
      stopImmediatePropagation() {
        restoredStopped = true;
      },
    });
    assert.equal(restoredStopped, true);
  } finally {
    f.close();
  }
});
test('reload and close retain native browser protection while dirty', () => {
  const f = fixture();
  try {
    const event = {
      preventDefault() {
        this.prevented = true;
      },
    };
    f.listeners.beforeunload(event);
    assert.equal(event.prevented, true);
    assert.equal(event.returnValue, '');
  } finally {
    f.close();
  }
});

test('a saved draft does not release protection for another mounted editor', () => {
  const f = fixture();
  try {
    const releaseOther = f.useUnsavedChanges(true);
    f.release();
    assert.equal(f.click('/app/help').prevented, true);
    assert.equal(f.prompts(), 1);
    releaseOther();
    assert.equal(f.click('/app/help').prevented, undefined);
    assert.equal(f.prompts(), 1);
  } finally {
    f.close();
  }
});
