import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const css = fs.readFileSync('src/app/globals.css', 'utf8');

test('shared submit control exposes progress and blocks duplicate actions from either form source', () => {
  for (const [nativePending, actionPending] of [
    [false, false],
    [true, false],
    [false, true],
  ]) {
    const { SubmitButton } = load('src/components/ui/submit-button.tsx', {
      'react-dom': { useFormStatus: () => ({ pending: nativePending }) },
      './form-pending': { FormPendingContext: React.createContext(actionPending) },
    });
    const html = render(
      React.createElement(
        SubmitButton,
        { className: 'button button-primary', pendingLabel: 'Creating ticket…' },
        'Create ticket',
      ),
    );
    const pending = nativePending || actionPending;
    assert.match(html, new RegExp(`aria-busy="${pending}"`));
    assert.equal(html.includes('disabled=""'), pending);
    assert.ok(html.includes(pending ? 'Creating ticket…' : 'Create ticket'));
    assert.match(html, /type="submit"/);
  }
});

test('shared action styles preserve touch targets, wrapping and non-color focus cues', () => {
  const button = css.match(/\.button \{([^}]+)\}/)[1];
  assert.match(button, /min-height: 44px/);
  assert.match(button, /min-width: 44px/);
  assert.match(button, /max-width: 100%/);
  assert.match(button, /white-space: normal/);
  assert.match(button, /overflow-wrap: anywhere/);
  assert.match(
    css,
    /:is\(button, \.button\):focus-visible \{[^}]*outline: 3px solid var\(--color-focus\)/,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.button\[aria-busy='true'\]::before \{\s*animation: none/,
  );
  assert.match(css, /@media \(forced-colors: active\) \{[\s\S]*?color: GrayText/);
  for (const variant of ['primary', 'secondary', 'quiet', 'danger']) {
    assert.ok(
      css.includes(
        `.button-${variant}:hover:not(:disabled):not([aria-disabled='true']):not([aria-busy='true'])`,
      ),
    );
  }
});
