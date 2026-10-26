import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { normalizeTag, popularTags } = load('src/features/tickets/tags.ts');

test('tags normalize to one lowercase single-spaced form and reject unsafe input', () => {
  assert.equal(normalizeTag('  VPN   Issue '), 'vpn issue');
  assert.equal(normalizeTag('hw.laptop_v2-a'), 'hw.laptop_v2-a');
  for (const bad of ['', '   ', '-leading', '<script>', 'x'.repeat(41), 42, null])
    assert.equal(normalizeTag(bad), null, String(bad));
});

test('tag suggestions rank by use, then alphabetically', () => {
  assert.deepEqual(popularTags(['vpn', 'printer', 'vpn', 'access', 'printer', 'vpn']), [
    'vpn',
    'printer',
    'access',
  ]);
  assert.deepEqual(popularTags(['b', 'a', 'c'], 2), ['a', 'b']);
});

test('the tag editor names each remove control and hides suggestions already applied', () => {
  const passthrough = ({ children }) => React.createElement('form', null, children);
  const { TicketTags } = load('src/features/tickets/ticket-tags.tsx', {
    '@/app/app/tickets/organize-actions': { addTicketTag() {}, removeTicketTag() {} },
    '@/components/ui/action-form': { ActionForm: passthrough },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children, ...props }) => {
        delete props.pendingLabel; // not a DOM attribute
        return React.createElement('button', props, children);
      },
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(TicketTags, {
      ticketId: 't1',
      tags: ['vpn', 'network'],
      suggestions: ['vpn', 'printer'],
    }),
  );
  assert.match(html, /aria-label="Remove tag vpn"/);
  assert.match(html, /aria-label="Remove tag network"/);
  assert.match(html, /<option value="printer">/);
  assert.doesNotMatch(html, /<option value="vpn">/, 'applied tags are not suggested again');
  assert.match(html, /visible to IT staff only/);
});
