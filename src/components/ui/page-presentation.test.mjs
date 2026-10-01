import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';

const mocks = { 'next/link': { default: props => React.createElement('a', props) } };
const { PageHeader } = load('src/components/ui/page-header.tsx', mocks);
test('shared page heading separates native back navigation, title and primary action', () => {
  const html = render(React.createElement(PageHeader, {
    title: 'New article', eyebrow: 'Knowledge base', description: 'Write a useful guide.',
    back: { href: '/app/help', label: 'Knowledge base' },
    actions: React.createElement('button', { type: 'button', className: 'button button-primary' }, 'Save draft'),
  }));
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /<a class="button button-quiet page-back-link" href="\/app\/help"/);
  assert.match(html, /<span aria-hidden="true">←<\/span>Knowledge base/);
  assert.ok(html.indexOf('</a>') < html.indexOf('<header'));
  assert.match(html, /<button type="button" class="button button-primary">Save draft/);
  assert.doesNotMatch(html, /role="button"/);
});
test('minimal headings do not render empty navigation, descriptions or action groups', () => {
  const html = render(React.createElement(PageHeader, { title: 'Security' }));
  assert.match(html, /<h1>Security<\/h1>/);
  assert.doesNotMatch(html, /<a |<p>|page-header-actions|page-eyebrow/);
});
test('shared loading state announces the wait once without fake data or animated controls', () => {
  const { PageLoading } = load('src/components/ui/page-loading.tsx', mocks);
  const html = render(React.createElement(PageLoading, { title: 'Assets', message: 'Loading equipment…' }));
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.match(html, /aria-live="polite" aria-atomic="true"/);
  assert.match(html, /page-loading-placeholder" aria-hidden="true"/);
  assert.match(html, /Loading equipment…/);
  assert.doesNotMatch(html, /<button|<input|<a |aria-valuenow|animation/);
});
test('navigation and pagination controls retain button treatment without inheriting tab borders', () => {
  const css = fs.readFileSync('src/app/globals.css', 'utf8');
  // Real regression: the former .queue-views a selector overrode pagination button borders and padding.
  assert.doesNotMatch(css, /\.queue-views a \{[^}]*border-bottom:/);
  assert.match(css, /\.queue-views a:not\(\.button\)/);
  assert.match(css, /\.queue-views a\[aria-current="page"\][^}]*font-weight: 700/);
  assert.match(css, /\.button-quiet \{[^}]*min-height: 44px/);
  assert.match(css, /\.button-secondary:hover:not\(:disabled\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
