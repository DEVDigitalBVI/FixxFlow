import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const props = {
  review: 'Request',
  assignment: 'Owner/status',
  conversation: React.createElement('textarea', { defaultValue: 'Draft' }),
  resolution: 'SLA',
  tools: 'Tools',
  activeWorkflow: false,
  history: 'History',
  files: 'Attachments',
  details: 'Metadata',
};
test('workspace exposes core work together and keeps secondary disclosures mounted', () => {
  const { TicketWorkspace } = load('src/features/tickets/ticket-workspace.tsx');
  const html = renderToStaticMarkup(React.createElement(TicketWorkspace, props));
  assert.doesNotMatch(html, /hidden=""|wizard|Show guidance|Back and Next/);
  for (const text of [
    'Owner/status',
    'Request',
    'Draft',
    'Metadata',
    'SLA',
    'Tools',
    'History',
    'Attachments',
  ])
    assert.ok(html.includes(text));
  assert.ok(html.indexOf('Owner/status') < html.indexOf('Request'));
  assert.ok(html.indexOf('Draft') < html.indexOf('Metadata'));
  assert.match(html, /<summary>Coordination<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  const active = renderToStaticMarkup(
    React.createElement(TicketWorkspace, { ...props, activeWorkflow: true }),
  );
  assert.match(active, /id="ticket-workflow-tools" open=""/);
});

test('old hashes open ancestors and focus their exact target without remounting drafts', () => {
  const saved = {
    HTMLElement: globalThis.HTMLElement,
    HTMLDetailsElement: globalThis.HTMLDetailsElement,
    CSS: globalThis.CSS,
  };
  class Element {
    constructor(parent = null) {
      this.parentElement = parent;
    }
    hasAttribute() {
      return false;
    }
    focus() {
      this.focused = true;
    }
    scrollIntoView() {
      this.scrolled = true;
    }
  }
  class Details extends Element {
    constructor(parent) {
      super(parent);
      this.open = false;
      this.summary = new Element(this);
    }
    querySelector() {
      return this.summary;
    }
  }
  Object.assign(globalThis, {
    HTMLElement: Element,
    HTMLDetailsElement: Details,
    CSS: { escape: (x) => x },
  });
  try {
    const { followTicketHash } = load('src/features/tickets/ticket-workflow.tsx');
    const root = new Element();
    const coordination = new Details(root);
    const assignment = new Details(root);
    const levels = new Details(root);
    const targets = {
      'ticket-assignment': assignment,
      'ticket-resolution': levels,
      'ticket-workflow-tools': coordination,
      'ticket-activity': new Details(root),
      'ticket-files': new Details(root),
      'ticket-review': new Element(root),
      'ticket-conversation': new Element(root),
    };
    for (const id of [
      'incident-summary',
      'communication-plan',
      'ticket-procedures',
      'response-checklist',
      'incident-approvals',
    ])
      targets[id] = new Element(coordination);
    root.querySelector = (selector) => targets[selector.slice(5, -2)];
    for (const id of Object.keys(targets).concat('ticket-details')) {
      followTicketHash(root, '#' + id);
      const target = targets[id === 'ticket-details' ? 'ticket-assignment' : id];
      const focus = target instanceof Details ? target.summary : target;
      assert.equal(focus.focused, true, id);
      assert.equal(focus.scrolled, true, id);
      if (target.parentElement === coordination) assert.equal(coordination.open, true, id);
      if (target instanceof Details) assert.equal(target.open, true, id);
    }
    assert.doesNotThrow(() => followTicketHash(root, '#%malformed'));
    assert.doesNotThrow(() => followTicketHash(root, '#unknown'));
  } finally {
    Object.assign(globalThis, saved);
  }
});

test('late streamed hashes focus once, cancel on navigation/interaction, and expire without stealing focus', () => {
  const keys = [
    'HTMLElement',
    'HTMLDetailsElement',
    'Element',
    'CSS',
    'MutationObserver',
    'setTimeout',
    'clearTimeout',
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  let timer,
    focuses = 0,
    observers = [];
  class Node {
    constructor(parent = null) {
      this.parentElement = parent;
      this.listeners = {};
    }
    hasAttribute() {
      return true;
    }
    focus() {
      focuses++;
    }
    scrollIntoView() {}
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    removeEventListener(name) {
      delete this.listeners[name];
    }
  }
  class Details extends Node {
    constructor(parent) {
      super(parent);
      this.open = false;
      this.summary = new Node(this);
    }
    querySelector() {
      return this.summary;
    }
  }
  class Observer {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(root, options) {
      this.root = root;
      assert.equal(options.subtree, true);
    }
    disconnect() {
      this.stopped = true;
    }
  }
  Object.assign(globalThis, {
    HTMLElement: Node,
    HTMLDetailsElement: Details,
    Element: Node,
    CSS: { escape: (x) => x },
    MutationObserver: Observer,
    setTimeout: (fn) => {
      timer = fn;
      return 1;
    },
    clearTimeout() {
      timer = null;
    },
  });
  try {
    const { observeTicketHash } = load('src/features/tickets/ticket-workflow.tsx');
    function setup(hash) {
      let target = null;
      const root = new Node();
      root.querySelector = () => target;
      const browser = {
        location: { hash },
        listeners: {},
        addEventListener(n, fn) {
          this.listeners[n] = fn;
        },
        removeEventListener(n) {
          delete this.listeners[n];
        },
      };
      const doc = new Node();
      const stop = observeTicketHash(root, browser, doc);
      return {
        root,
        browser,
        stop,
        setTarget: () => {
          const parent = new Details(root);
          target = new Node(parent);
          return parent;
        },
      };
    }
    let f = setup('#communication-plan');
    assert.equal(focuses, 0);
    const parent = f.setTarget();
    observers.at(-1).callback();
    assert.equal(parent.open, true);
    assert.equal(focuses, 1);
    assert.equal(observers.at(-1).stopped, true);
    assert.equal(timer, null);
    f.stop();
    f = setup('#incident-summary');
    const pending = observers.at(-1);
    f.browser.location.hash = '';
    pending.callback();
    assert.equal(pending.stopped, true);
    assert.equal(focuses, 1);
    f.stop();
    f = setup('#ticket-procedures');
    const abandoned = observers.at(-1);
    f.root.listeners.keydown();
    assert.equal(abandoned.stopped, true);
    assert.equal(timer, null);
    f.stop();
    f = setup('#incident-summary');
    const expired = observers.at(-1);
    timer();
    assert.equal(expired.stopped, true);
    f.stop();
    const before = observers.length;
    f = setup('');
    assert.equal(observers.length, before, 'ordinary streaming never observes or moves focus');
    f.stop();
    assert.equal(focuses, 1);
  } finally {
    Object.assign(globalThis, saved);
  }
});
