import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const parent = '30000000-0000-0000-0000-000000000961';
const mocks = {
  '@/components/ui/action-form': {
    ActionForm: ({ children }) => React.createElement('form', null, children),
  },
  '@/components/ui/submit-button': {
    SubmitButton: ({ children }) => React.createElement('button', null, children),
  },
  '@/features/lookups/lookup-select': {
    LookupSelect: ({ resource, name, label, parentId, defaultValue, emptyLabel }) =>
      React.createElement(
        'label',
        null,
        label,
        React.createElement(
          'select',
          { name, 'data-resource': resource, 'data-exclude': parentId, defaultValue },
          React.createElement('option', { value: '' }, emptyLabel),
          React.createElement('option', { value: parent }, 'Head office / First floor'),
        ),
      ),
  },
  '@/app/app/organization/actions': { editOrganizationItem: async () => ({}) },
};

test('add sublocation preselects a parent and repeated forms keep unique field labels', () => {
  const { OrganizationCreateForm } = load(
    'src/features/administration/organization-create-form.tsx',
    mocks,
  );
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      ...[1, 2].map((key) =>
        React.createElement(OrganizationCreateForm, {
          key,
          kind: 'location',
          parentId: parent,
          action: async () => ({}),
        }),
      ),
    ),
  );
  assert.match(html, /Parent location/);
  assert.match(html, /None — top-level location/);
  assert.equal(
    [...html.matchAll(/value="30000000-0000-0000-0000-000000000961" selected/g)].length,
    2,
  );
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ids) assert.ok(html.includes(`for="${id}"`));
});

test('edit parent picker excludes the current subtree and retains the selected parent', () => {
  const { OrganizationItemEditor } = load(
    'src/features/administration/organization-item-editor.tsx',
    mocks,
  );
  const html = renderToStaticMarkup(
    React.createElement(OrganizationItemEditor, {
      kind: 'locations',
      item: {
        id: 'room',
        name: 'Room 101',
        path: 'Head office / First floor / Room 101',
        parent_id: parent,
        updated_at: '2026-11-01',
        timezone: 'UTC',
      },
    }),
  );
  assert.match(html, /data-resource="location_parents" data-exclude="room"/);
  assert.match(html, /selected/);
  assert.match(html, /Head office \/ First floor \/ Room 101/);
});
