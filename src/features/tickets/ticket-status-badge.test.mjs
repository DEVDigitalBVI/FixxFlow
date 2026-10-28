import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';
import { productStyles } from '../../../tests/helpers/styles.mjs';

const { TicketStatusBadge } = load('src/features/tickets/ticket-status-badge.tsx');
const { ticketStatuses, ticketPriorities } = load('src/features/tickets/presentation.ts');
test('every ticket status and priority exposes its written label plus a decorative shared outline icon', () => {
  for (const [prop, mapping] of [
    ['status', ticketStatuses],
    ['priority', ticketPriorities],
  ])
    for (const [value, item] of Object.entries(mapping)) {
      const html = renderToStaticMarkup(React.createElement(TicketStatusBadge, { [prop]: value }));
      assert.ok(html.includes(item.label));
      assert.ok(html.includes(`tone-${item.tone}`));
      assert.match(html, /<svg class="badge-icon" aria-hidden="true" focusable="false"/);
      assert.match(html, /stroke="currentColor"/);
      assert.doesNotMatch(html, /role="img"|tabindex/);
    }
  assert.equal(new Set(Object.values(ticketStatuses).map((x) => x.icon)).size, 7);
});
const css = productStyles();
function tokens(block) {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}
function resolve(value, vars) {
  return value.startsWith('var(') ? resolve(vars[value.slice(4, -1)], vars) : value;
}
function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((n) => parseInt(n, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
test('status colors meet WCAG AA in explicit and automatic themes, within the shared yellow and neutral palette', () => {
  const base = tokens(css.match(/:root \{([\s\S]*?)\n\s*\}/)[1]);
  const explicit = tokens(css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\s*\}/)[1]);
  const automatic = tokens(css.match(/:root:not\(\[data-theme\]\) \{([\s\S]*?)\n\s*\}/)[1]);
  assert.deepEqual(automatic, explicit);
  for (const vars of [base, { ...base, ...explicit }]) {
    for (const role of ['active', 'warning', 'success', 'danger', 'neutral']) {
      const fg = resolve(vars[`--color-${role}`], vars),
        bg = resolve(
          vars[
            `--color-${role}-${['warning', 'success', 'neutral'].includes(role) ? 'subtle' : 'surface'}`
          ],
          vars,
        );
      assert.ok(contrast(fg, bg) >= 4.5, `${role}: ${contrast(fg, bg).toFixed(2)} must meet 4.5:1`);
    }
  }
  assert.notEqual(explicit['--color-surface'], explicit['--color-canvas']);
  assert.doesNotMatch(css, /--color-(?:info|cyan|brand-purple|danger-subtle)(?:\s*:|\))/);
});
