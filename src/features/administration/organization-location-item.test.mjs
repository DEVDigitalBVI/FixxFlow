import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const { OrganizationLocationItem } = load(
  'src/features/administration/organization-location-item.tsx',
  {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/app/app/organization/actions': { editOrganizationItem: '/edit' },
    '@/components/ui/action-form': {
      ActionForm: ({ children, action, className }) =>
        React.createElement(
          'form',
          { className, action: typeof action === 'string' ? action : '/add' },
          children,
        ),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children, ...props }) => {
        const button = { ...props };
        delete button.pendingLabel;
        delete button.variant;
        delete button.size;
        return React.createElement('button', { ...button, type: 'submit' }, children);
      },
    },
    '@/features/lookups/lookup-select': {
      LookupSelect: ({ name, label, defaultValue = '', emptyLabel }) =>
        React.createElement(
          'label',
          null,
          label,
          React.createElement(
            'select',
            { name, defaultValue },
            React.createElement('option', { value: '' }, emptyLabel),
            React.createElement('option', { value: 'building' }, 'Admin Building'),
          ),
        ),
    },
  },
);

function render(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(OrganizationLocationItem, {
      item: {
        id: 'building',
        name: 'Admin Building',
        path: 'Admin Building',
        parent_id: null,
        depth: 1,
        city: null,
        region: null,
        country_code: 'VG',
        timezone: 'America/Tortola',
        is_active: true,
        updated_at: '2026-11-01T12:00:00Z',
        ...overrides,
      },
      addAction: '/add',
      toggleAction: '/toggle',
      deleteAction: '/delete',
    }),
  );
}

test('location row groups written metadata and preserves named lifecycle controls and confirmation', () => {
  const html = render();
  assert.match(html, /class="organization-location-meta"/);
  assert.match(html, />Active<\/span><span aria-hidden="true">·<\/span><span>VG<\/span>/);
  assert.match(html, /Add sublocation<span class="sr-only"> to Admin Building/);
  assert.match(
    html,
    /aria-label="Deactivate location Admin Building" aria-describedby="deactivate-description-building"/,
  );
  assert.match(
    html,
    /id="deactivate-description-building">Hidden from new selections\. Existing records stay linked\./,
  );
  assert.match(html, /<input(?=[^>]*name="confirmDelete")(?=[^>]*required="")[^>]*>/);
  assert.match(html, /I confirm permanent deletion of Admin Building/);
});

test('inactive locations retain edit, activation and deletion, omitting creation and deactivation hints', () => {
  const html = render({ is_active: false, country_code: null });
  assert.match(html, />Inactive<\/span>/);
  assert.match(html, /America\/Tortola/);
  assert.match(html, /aria-label="Activate location Admin Building"/);
  assert.match(html, /Edit<span class="sr-only"> Admin Building/);
  assert.doesNotMatch(html, /Add sublocation|deactivate-description-building/);
});

test('depth limit hides only add sublocation and full paths remain escaped and accessible', () => {
  const path = 'Admin Building / Floor <one> / Room & storage';
  const html = render({ depth: 8, path });
  assert.doesNotMatch(html, /Add sublocation/);
  assert.match(html, /<strong>Admin Building \/ Floor &lt;one&gt; \/ Room &amp; storage<\/strong>/);
  assert.match(
    html,
    /aria-label="Deactivate location Admin Building \/ Floor &lt;one&gt; \/ Room &amp; storage"/,
  );
});

const { OrganizationLocationList } = load(
  'src/features/administration/organization-location-item.tsx',
  {
    './organization-create-form': { OrganizationCreateForm: () => null },
    './organization-item-editor': { OrganizationItemEditor: () => null },
    './organization-item-actions': { OrganizationItemActions: () => null },
  },
);

function location(id, parent_id = null, depth = 1, is_active = true) {
  return {
    id,
    name: id,
    path: id,
    parent_id,
    depth,
    is_active,
    city: null,
    region: null,
    country_code: 'VG',
    timezone: 'America/Tortola',
    updated_at: '2026-11-01T12:00:00Z',
  };
}

function renderList(items) {
  return renderToStaticMarkup(
    React.createElement(OrganizationLocationList, {
      items,
      addAction: '/add',
      toggleAction: '/toggle',
      deleteAction: '/delete',
    }),
  );
}

test('sublocations render inside their parent section once, preserving sibling order and inactive entries', () => {
  const html = renderList([
    location('Accounting', 'Admin', 2),
    location('Storage', 'Accounting', 3, false),
    location('Purchasing', 'Admin', 2),
    location('Admin'),
    location('Warehouse'),
  ]);
  const lists = [];
  const positions = [];
  for (const token of html.matchAll(/<ul\b[^>]*|<\/ul>|<strong>([^<]*)<\/strong>/g)) {
    if (token[0].startsWith('<ul')) lists.push(token[0].match(/aria-label="([^"]*)"/)[1]);
    else if (token[0] === '</ul>') lists.pop();
    else positions.push([token[1], [...lists]]);
  }
  assert.deepEqual(positions, [
    ['Admin', ['Locations']],
    ['Accounting', ['Locations', 'Sublocations of Admin']],
    ['Storage', ['Locations', 'Sublocations of Admin', 'Sublocations of Accounting']],
    ['Purchasing', ['Locations', 'Sublocations of Admin']],
    ['Warehouse', ['Locations']],
  ]);
  assert.match(html, />Inactive<\/span>/);
  assert.doesNotMatch(html, /role="tree"/);
});

test('all eight levels remain nested and missing parents do not hide locations', () => {
  const items = Array.from({ length: 8 }, (_, i) =>
    location(`Level ${i + 1}`, i ? `Level ${i}` : null, i + 1),
  );
  const html = renderList([...items, location('Unlinked', 'missing', 2)]);
  assert.equal((html.match(/class="organization-location-children"/g) ?? []).length, 7);
  for (const item of items) assert.equal(html.split(`<strong>${item.path}</strong>`).length - 1, 1);
  assert.match(html, /<strong>Unlinked<\/strong>/);
  assert.equal(renderList([]), '');
});
