import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { load } from '../../../tests/helpers/load-module.mjs';

function fixture() {
  const slots = []; let cursor = 0;
  const calls = [], oldWindow = globalThis.window, oldElement = globalThis.Element;
  globalThis.Element = class {};
  globalThis.window = { scrollY: 42, location: { origin: 'https://example.test' }, matchMedia: () => ({ matches: true }) };
  const { TicketQueueContext } = load('src/features/tickets/queue-context.tsx', {
    react: { ...React, useEffect() {}, useRef: initial => { const index = cursor++; return slots[index] ??= { current: initial }; } },
    'next/navigation': { useRouter: () => Object.fromEntries(['push', 'replace', 'back'].map(name => [name, (...args) => calls.push([name, ...args])])) },
    '@/components/ui/unsaved-changes': { confirmDiscardChanges: () => true },
  });
  return { calls, render(panel = null, allowDrawer = true) { cursor = 0; return TicketQueueContext({ children: 'Queue', panel, returnTo: '/app/tickets?view=mine&page=3', selected: panel ? 'one' : undefined, allowDrawer }); }, click(tree, id, modifiers = {}) { const link = { dataset: { queueTicket: id } }, target = new globalThis.Element(); target.closest = () => link; const event = { target, button: 0, preventDefault() { this.prevented = true; }, ...modifiers }; tree.props.children[0].props.onClickCapture(event); return event; }, close() { globalThis.window = oldWindow; globalThis.Element = oldElement; } };
}

test('first desktop inspection pushes history; switching tickets replaces it so Close returns to the queue', () => {
  const f = fixture();
  try {
    assert.equal(f.click(f.render(), 'one').prevented, true);
    assert.deepEqual(f.calls[0], ['push', '/app/tickets?view=mine&page=3&ticket=one', { scroll: false }]);
    const panel = f.render('Details'); f.click(panel, 'two');
    assert.equal(f.calls[1][0], 'replace');
    panel.props.children[1].props.children[0].props.children[1].props.onClick();
    assert.deepEqual(f.calls[2], ['back']);
  } finally { f.close(); }
});

test('deep-linked panels close to validated queue context and employee/new-tab links remain native', () => {
  const f = fixture();
  try {
    const panel = f.render('Details');
    panel.props.children[1].props.children[0].props.children[1].props.onClick();
    assert.deepEqual(f.calls[0], ['replace', '/app/tickets?view=mine&page=3', { scroll: false }]);
    assert.equal(f.click(f.render(), 'two', { metaKey: true }).prevented, undefined);
    assert.equal(f.click(f.render(null, false), 'two').prevented, undefined);
    assert.equal(f.calls.length, 1);
  } finally { f.close(); }
});
