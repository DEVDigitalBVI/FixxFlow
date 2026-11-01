import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

test('initial loading provides a skip-link target and one announcement before identity loads', () => {
  const { default: Loading } = load('src/app/loading.tsx');
  const html = renderToStaticMarkup(React.createElement(Loading));
  assert.match(html, /<main id="main-content">/);
  assert.match(html, /<h1[^>]*>FixxFlow<\/h1>/);
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.match(html, /aria-live="polite" aria-atomic="true"/);
  assert.match(html, /Loading your workspace…/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /Sign out|sidebar-account/);
});
