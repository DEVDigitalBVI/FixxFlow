import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../tests/helpers/load-module.mjs';

const mocks = { 'next/link': { default: (props) => React.createElement('a', props) } };
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
    if (layout === 'main') assert.match(html, /<main id="main-content"/);
    else assert.doesNotMatch(html, /<main/);
    findButton(tree).props.onClick();
    assert.equal(retried, 1);
  }
});
