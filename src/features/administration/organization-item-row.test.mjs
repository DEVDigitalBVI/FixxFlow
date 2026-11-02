import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { OrganizationItemRow } = load('src/features/administration/organization-item-row.tsx', {
  './organization-item-editor': {
    OrganizationItemEditor: ({ item }) =>
      React.createElement(
        'details',
        { className: 'settings-editor' },
        React.createElement('summary', null, `Edit ${item.name}`),
      ),
  },
  '@/components/ui/disclosure-action-form': {
    DisclosureActionForm: ({ children, className }) =>
      React.createElement('form', { className }, children),
  },
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
});

for (const kind of ['department', 'location']) {
  test(`${kind} entries share identity, grouped actions and separate hints for all content lengths`, () => {
    for (const name of ['Administration', 'A'.repeat(100)]) {
      for (const active of [true, false]) {
        const description = 'Includes Accounting, HR & operations. '.repeat(40);
        const html = renderToStaticMarkup(
          React.createElement(OrganizationItemRow, {
            kind,
            item: { id: 'entry', name, description, is_active: active, updated_at: 'version' },
            toggleAction: async () => {},
            deleteAction: async () => {},
          }),
        );
        assert.match(html, /class="organization-entry-identity"/);
        assert.match(
          html,
          /class="organization-entry-controls"><div class="organization-item-actions"><details class="settings-editor"/,
        );
        assert.match(
          html,
          new RegExp(`aria-label="${active ? 'Deactivate' : 'Activate'} ${kind} ${name}"`),
        );
        assert.match(html, />Delete<span class="sr-only">/);
        assert.match(html, new RegExp(`>${active ? 'Active' : 'Inactive'}<`));
        if (kind === 'department')
          assert.ok(
            html.indexOf('Includes Accounting') < html.indexOf('organization-entry-controls'),
          );
        if (active)
          assert.match(
            html,
            /<\/details><\/div><small class="muted" id="deactivate-description-entry">/,
          );
        else assert.doesNotMatch(html, /deactivate-description-entry/);
      }
    }
  });
}
