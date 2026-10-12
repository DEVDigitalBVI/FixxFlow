import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { load } from '../../../tests/helpers/load-module.mjs';

function fixture() {
  let cursor = 0, tree, portalTarget, approved = true;
  const slots = [], calls = [], original = globalThis.document;
  const body = {};
  globalThis.document = { body, activeElement: null, getElementById: () => null };
  const hooks = { ...React, useEffect() {}, useMemo: compute => compute(), useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; }, useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; } };
  const { GlobalSearch } = load('src/features/search/global-search.tsx', { react: hooks, 'react-dom': { createPortal: (child, target) => { portalTarget = target; return child; } }, 'next/navigation': { useRouter: () => ({ push: href => calls.push(href) }) }, '@/components/ui/unsaved-changes': { confirmDiscardChanges: () => approved } });
  const walk = (node, predicate) => {
    if (Array.isArray(node)) { for (const child of node) { const found = walk(child, predicate); if (found) return found; } }
    else if (node?.props) { if (predicate(node)) return node; return walk(node.props.children, predicate); }
  };
  const render = () => { cursor = 0; tree = GlobalSearch({ role: 'end_user', inventoryAccess: false, onOpen() {} }); };
  render();
  return { body, calls, target: () => portalTarget, find: predicate => walk(tree, predicate), render, approve: value => { approved = value; }, close() { globalThis.document = original; } };
}

test('search dialog mounts outside hidden mobile navigation and groups results for assistive technology', () => {
  const f = fixture();
  try {
    f.find(node => node.type === 'button').props.onClick(); f.render();
    assert.equal(f.target(), f.body);
    assert.equal(f.find(node => node.type === 'dialog').props['aria-labelledby'], 'global-search-title');
    assert.equal(f.find(node => node.props.role === 'group').props['aria-label'], 'Navigation');
    assert.equal(f.find(node => node.props.role === 'combobox').props['aria-controls'], 'global-search-results');
  } finally { f.close(); }
});

test('keyboard selection moves through results; modified links stay native and cancelled discard keeps search open', () => {
  const f = fixture();
  try {
    f.find(node => node.type === 'button').props.onClick(); f.render();
    f.find(node => node.props.role === 'combobox').props.onKeyDown({ key: 'ArrowDown', nativeEvent: {}, preventDefault() {} }); f.render();
    assert.equal(f.find(node => node.props.role === 'option' && node.props['aria-selected']).props.href, '/app/tickets');
    const option = f.find(node => node.props.role === 'option' && node.props['aria-selected']);
    option.props.onClick({ metaKey: true }); assert.deepEqual(f.calls, []);
    f.approve(false);
    f.find(node => node.props.role === 'combobox').props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {} }); f.render();
    assert.ok(f.find(node => node.type === 'dialog')); assert.deepEqual(f.calls, []);
    f.approve(true);
    f.find(node => node.props.role === 'combobox').props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {} }); f.render();
    assert.deepEqual(f.calls, ['/app/tickets']); assert.equal(f.find(node => node.type === 'dialog'), undefined);
  } finally { f.close(); }
});

test('Escape closes search directly instead of only clearing the native search field', () => {
  const f = fixture();
  try {
    f.find(node => node.type === 'button').props.onClick(); f.render();
    const input = f.find(node => node.props.role === 'combobox');
    input.props.onChange({ target: { value: 'VPN' } }); f.render();
    let prevented = false, stopped = false;
    f.find(node => node.props.role === 'combobox').props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }); f.render();
    assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(f.find(node => node.type === 'dialog'), undefined);
  } finally { f.close(); }
});
