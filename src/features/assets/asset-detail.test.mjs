import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';

const asset = { id: 'asset-a', name: 'Reception laptop', tag: 'PC-001', kind: 'computer', status: 'in_use', model: 'Example notebook', serial_number: '001234', assigned_user_id: null, location_id: null, purchased_on: '2026-01-02', warranty_until: null, revision: 4 };
function find(node, predicate) {
  if (!React.isValidElement(node)) return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) { const match = find(child, predicate); if (match) return match; }
  return null;
}
test('asset overview shows saved identity, ownership and timezone-safe dates without form controls', () => {
  const { AssetOverview } = load('src/features/assets/asset-overview.tsx');
  const html = render(React.createElement(AssetOverview, { asset, owner: 'Unassigned', location: 'Main office' }));
  for (const value of ['Identity', 'Assignment', 'Purchase &amp; warranty', 'PC-001', '001234', 'Unassigned', 'Main office', 'Jan 2, 2026', 'Not recorded']) assert.ok(html.includes(value));
  assert.match(html, /<time dateTime="2026-01-02">/);
  assert.doesNotMatch(html, /<input|<select|<form/);
});
test('opening an asset starts in overview; Edit opens the form and cancel restores button focus', () => {
  let editing = false, focused = false, refIndex = 0; const effects = [];
  const refs = [{ current: { focus: () => { focused = true; } } }, { current: false }];
  const Form = () => null;
  const { AssetDetailEditor } = load('src/features/assets/asset-detail-editor.tsx', {
    react: { ...React, useState: () => [editing, value => { editing = value; }], useRef: () => refs[refIndex++], useEffect: fn => effects.push(fn) },
    '@/features/assets/asset-form': { AssetForm: Form },
  });
  const draw = () => { refIndex = 0; return AssetDetailEditor({ asset, people: [], locations: [], children: React.createElement('p', null, 'Saved details') }); };
  let tree = draw(); const html = render(tree);
  assert.match(html, /Asset overview/); assert.match(html, /Edit asset/); assert.doesNotMatch(html, /<form/);
  find(tree, n => n.type === 'button').props.onClick(); tree = draw();
  assert.equal(tree.type, Form); assert.equal(tree.props.asset.revision, 4);
  tree.props.onCancel(); tree = draw(); effects.at(-1)();
  assert.equal(editing, false); assert.equal(focused, true); assert.match(render(tree), /Saved details/);
});
function editor({ dirty = false, pending = false, confirm = true } = {}) {
  let cancelled = false, confirmations = 0;
  const originalWindow = globalThis.window;
  globalThis.window = { confirm: () => { confirmations++; return confirm; } };
  const { AssetForm } = load('src/features/assets/asset-form.tsx', {
    react: { ...React, useState: value => [dirty ? { ...value, name: 'Changed draft' } : value, () => {}], useActionState: () => [{}, () => {}, pending], useEffect: () => {}, useRef: () => ({ current: null }) },
    'next/link': { default: p => React.createElement('a', p) },
    '@/app/app/assets/actions': { saveAsset: () => {} },
    '@/components/ui/submit-button': { SubmitButton: p => React.createElement('button', p) },
  });
  try {
    const tree = AssetForm({ asset, people: [], locations: [], onCancel: () => { cancelled = true; } });
    const button = find(tree, n => n.type === 'button' && n.props.type === 'button');
    button.props.onClick();
    return { html: render(tree), cancelled, confirmations, disabled: button.props.disabled };
  } finally { globalThis.window = originalWindow; }
}
test('cancel leaves clean editing immediately and focuses the first field when editing opens', () => {
  const result = editor(); assert.equal(result.cancelled, true); assert.equal(result.confirmations, 0);
  assert.match(result.html, /<input[^>]*autofocus[^>]*name="tag"/); assert.match(result.html, /Cancel editing/);
});
test('dirty cancellation requires confirmation; rejected discard preserves the draft', () => {
  const stay = editor({ dirty: true, confirm: false }); assert.equal(stay.cancelled, false); assert.equal(stay.confirmations, 1); assert.match(stay.html, /value="Changed draft"/);
  assert.equal(editor({ dirty: true, confirm: true }).cancelled, true);
});
test('cancel editing is unavailable during the save request', () => { assert.equal(editor({ pending: true }).disabled, true); });
