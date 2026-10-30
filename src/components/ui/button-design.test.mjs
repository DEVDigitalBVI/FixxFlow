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

test('kit button preserves touch targets, wrapping, non-color focus cues and semantic variants', () => {
  const { buttonVariants } = load('src/components/ui/button.tsx');
  const base = buttonVariants({ variant: 'secondary' });
  for (const rule of [
    'min-h-11',
    'min-w-11',
    'max-w-full',
    'whitespace-normal',
    '[overflow-wrap:anywhere]',
    'focus-visible:outline-3',
    'focus-visible:outline-(color:--color-focus)',
    'motion-reduce:transition-none',
  ])
    assert.ok(base.split(' ').includes(rule), rule);
  for (const variant of ['primary', 'secondary', 'quiet', 'danger']) {
    const classes = buttonVariants({ variant }).split(' ');
    // Stable hooks keep contextual layout, busy and forced-colors rules applying to kit buttons.
    assert.equal(classes[0], 'button');
    assert.ok(classes.includes(`button-${variant}`));
    assert.ok(
      classes.some((c) => c.startsWith('hover:not-disabled:not-aria-disabled:not-aria-busy:')),
      `${variant} hover skips inactive states`,
    );
  }
  assert.ok(buttonVariants({ variant: 'quiet', size: 'small' }).includes('button-small'));
  assert.ok(buttonVariants({ variant: 'quiet', size: 'icon' }).includes('size-11'));
  // Variant colors replace the base transparent edge instead of competing with it.
  const primary = buttonVariants({ variant: 'primary' }).split(' ');
  assert.ok(primary.includes('border-(color:--color-brand-ink)'));
  assert.ok(!primary.includes('border-transparent'));
  // Feature-specific native buttons keep the shared focus, busy and forced-colors treatment.
  assert.match(
    css,
    /:is\(button, \.button\):focus-visible \{[^}]*outline: 3px solid var\(--color-focus\)/,
  );
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.button\[aria-busy='true'\]::before \{\s*animation: none/,
  );
  assert.match(css, /@media \(forced-colors: active\) \{[\s\S]*?color: GrayText/);
});

test('kit text fields keep 44px targets, visible focus, invalid state and stable hooks', () => {
  const { fieldClassName } = load('src/components/ui/input.tsx');
  const classes = fieldClassName.split(' ');
  for (const rule of [
    'input',
    'min-h-11',
    'border-(color:--color-control-border)',
    'focus:border-(color:--color-focus)',
    'focus:outline-hidden',
    'aria-invalid:border-(color:--color-danger)',
    'placeholder:text-(color:--color-text-subtle)',
  ])
    assert.ok(classes.includes(rule), rule);
  const { Input, Textarea } = load('src/components/ui/input.tsx');
  assert.match(render(React.createElement(Input, { fieldSize: 'compact' })), /input-compact/);
  const tall = render(React.createElement(Textarea, { fieldSize: 'tall' }));
  assert.match(tall, /class="input [^"]*\btextarea\b[^"]*min-h-\[110px\]/);
  assert.doesNotMatch(render(React.createElement(Textarea)), /min-h-\[110px\]/);
});

test('pending submit buttons display the current upload stage while remaining disabled', () => {
  const { SubmitButton } = load('src/components/ui/submit-button.tsx', {
    'react-dom': { useFormStatus: () => ({ pending: false }) },
    './form-pending': { FormPendingContext: React.createContext(true) },
    './form-progress': {
      FormProgressContext: React.createContext('Request created. Uploading file 2 of 3…'),
    },
  });
  const html = render(
    React.createElement(SubmitButton, { pendingLabel: 'Sending request…' }, 'Submit request'),
  );
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Request created. Uploading file 2 of 3…/);
  assert.doesNotMatch(html, /Sending request…/);
});
