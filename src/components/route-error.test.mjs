import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { kitHostMocks } from '../../tests/helpers/kit-host-mocks.mjs';
import { load } from '../../tests/helpers/load-module.mjs';

const mocks = {
  ...kitHostMocks(),
  'next/link': { default: (props) => React.createElement('a', props) },
};
const { RouteError } = load('src/components/route-error.tsx', mocks);
function findButton(node) {
  if (!React.isValidElement(node)) return;
  if (node.type === 'button') return node;
  return React.Children.toArray(node.props.children).map(findButton).find(Boolean);
}
test('error recovery keeps an alert, explicit retry, and safe navigation across layouts', () => {
  for (const layout of ['page', 'card', 'narrow', 'main']) {
    let retried = 0;
    const tree = RouteError({
      retry: () => retried++,
      title: 'Unable to load',
      message: 'Try again. Your draft is preserved.',
      layout,
      back: { href: '/app', label: 'Back to overview' },
    });
    const html = renderToStaticMarkup(tree);
    assert.match(html, /role="alert"/);
    assert.match(html, /href="\/app"/);
    assert.match(html, /type="button"/);
    assert.match(html, /class="[^"]*route-error-panel/);
    assert.match(html, /class="route-error-actions"/);
    assert.doesNotMatch(html, /knowledge-actions|page-header-actions/);
    if (layout === 'main') assert.match(html, /<main id="main-content"/);
    else assert.doesNotMatch(html, /<main/);
    findButton(tree).props.onClick();
    assert.equal(retried, 1);
  }
});

test('a recovery panel without back navigation keeps one heading, alert and retry action', () => {
  let retried = 0;
  const tree = RouteError({
    retry: () => retried++,
    title: 'Could not load',
    message: 'Try again.',
  });
  const html = renderToStaticMarkup(tree);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.equal((html.match(/role="alert"/g) ?? []).length, 1);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<a\b/);
  findButton(tree).props.onClick();
  assert.equal(retried, 1);
});
