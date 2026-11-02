import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { componentHarness } from '../../../tests/helpers/component-harness.mjs';
import { load } from '../../../tests/helpers/load-module.mjs';

const self = '10000000-0000-4000-8000-000000000901';
const employee = '10000000-0000-4000-8000-000000000902';
const second = '10000000-0000-4000-8000-000000000903';
const people = [
  { id: employee, name: 'Alex Rivers', email: 'alex@example.invalid' },
  { id: second, name: 'Jordan Lane', email: 'jordan@example.invalid' },
];
const controls = 'src/features/administration/people-deletion-controls.tsx';
const actionMocks = { '@/app/app/people/actions': { deletePeople: async () => ({}) } };

function actionFixture({ role = 'administrator', error = null, count = 2 } = {}) {
  const calls = [],
    refreshed = [];
  const { deletePeople } = load('src/app/app/people/actions.ts', {
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ id: self, role, organizationId: 'workspace' }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: count, error };
        },
      }),
    },
    'next/cache': { revalidatePath: (...args) => refreshed.push(args) },
  });
  const form = (ids = [employee, second], confirmed = true) => {
    const data = new FormData();
    ids.forEach((id) => data.append('personIds', id));
    if (confirmed) data.set('confirmDelete', 'yes');
    data.set('q', 'Alex');
    data.set('view', 'technicians');
    data.set('returnTo', 'https://untrusted.example/');
    return data;
  };
  return { deletePeople, form, calls, refreshed };
}

test('server action validates authorization, bounded IDs, self protection and explicit confirmation before mutation', async () => {
  const noAccess = actionFixture({ role: 'end_user' });
  assert.match((await noAccess.deletePeople(noAccess.form())).error, /Only IT staff/);
  assert.equal(noAccess.calls.length, 0);
  for (const [ids, confirmed] of [
    [[], true],
    [['invalid'], true],
    [[self], true],
    [[employee], false],
    [Array(26).fill(employee), true],
  ]) {
    const f = actionFixture();
    assert.ok((await f.deletePeople(f.form(ids, confirmed))).error);
    assert.equal(f.calls.length, 0);
  }
});

test('deletion sends unique IDs and the viewer workspace to one atomic RPC and retains only safe list context', async () => {
  const f = actionFixture({ role: 'technician' });
  const result = await f.deletePeople(f.form([employee, second, employee]));
  assert.deepEqual(f.calls, [
    {
      name: 'delete_workspace_people',
      args: { org: 'workspace', targets: [employee, second], confirmed: true },
    },
  ]);
  assert.deepEqual(f.refreshed, [['/app', 'layout']]);
  const url = new URL(result.redirectTo, 'https://fixture.test');
  assert.equal(url.origin, 'https://fixture.test');
  assert.equal(url.pathname, '/app/people');
  assert.equal(url.searchParams.get('q'), 'Alex');
  assert.equal(url.searchParams.get('view'), 'technicians');
  assert.match(url.searchParams.get('success'), /2 people deleted/);
  assert.equal(url.searchParams.has('returnTo'), false);
});

test('permission conflicts, missing members and uncertain outcomes preserve the selection and offer recovery', async () => {
  for (const code of ['42501', 'P0002', 'NETWORK_ERROR']) {
    const f = actionFixture({ error: { code } });
    const result = await f.deletePeople(f.form());
    assert.ok(result.error);
    assert.equal(result.redirectTo, undefined);
    assert.deepEqual(f.refreshed, []);
    if (code === 'NETWORK_ERROR')
      assert.match(result.error, /could not be confirmed.*retry safely/);
  }
  const retry = actionFixture({ count: 0 });
  assert.match(
    new URL(
      (await retry.deletePeople(retry.form())).redirectTo,
      'https://fixture.test',
    ).searchParams.get('success'),
    /already deleted/,
  );
});

test('role rules allow administrators, restrict technicians to employees and always exclude self', () => {
  const { canDeletePerson } = load('src/features/administration/people-deletion-model.ts');
  for (const viewer of ['end_user', 'technician', 'administrator'])
    for (const target of ['end_user', 'technician', 'administrator']) {
      assert.equal(canDeletePerson(viewer, target, true), false);
      assert.equal(
        canDeletePerson(viewer, target, false),
        viewer === 'administrator' || (viewer === 'technician' && target === 'end_user'),
      );
    }
});

test('selection supports individual choices, select all, mixed state, clear and a fresh confirmation after changes', () => {
  const ui = componentHarness(
    controls,
    'PeopleSelection',
    { people, search: '', view: '', children: 'Directory' },
    actionMocks,
  );
  try {
    const checkbox = () =>
      ui.find((node) => node.type === 'input' && node.props.type === 'checkbox');
    const provider = () => ui.find((node) => node.props.value?.toggle);
    assert.equal(checkbox().props.checked, false);
    provider().props.value.toggle(employee, true);
    ui.render();
    assert.match(
      String(ui.find((node) => node.props.role === 'status').props.children),
      /1.*selected/,
    );
    assert.equal(checkbox().props.ref.current.indeterminate, true);
    const oldKey = ui.find((node) => node.props.bulk).key;
    checkbox().props.onChange({ target: { checked: true } });
    ui.render();
    assert.equal(checkbox().props.checked, true);
    assert.equal(checkbox().props.ref.current.indeterminate, false);
    assert.notEqual(ui.find((node) => node.props.bulk).key, oldKey);
    assert.equal(ui.find((node) => node.props.bulk).props.people.length, 2);
    ui.find(
      (node) => node.type === 'button' && node.props.children === 'Clear selection',
    ).props.onClick();
    ui.render();
    assert.equal(ui.find((node) => node.props.bulk).props.people.length, 0);
    assert.ok(ui.focuses.length);
  } finally {
    ui.close();
  }
});

test('confirmation names every person, preserves hidden IDs and requires acknowledgement with a safe cancel focus target', () => {
  const ui = componentHarness(controls, 'DeletePeopleControl', { people, bulk: true }, actionMocks);
  try {
    assert.equal(ui.all((node) => node.props.name === 'personIds').length, 2);
    const confirm = ui.find((node) => node.props.name === 'confirmDelete');
    assert.equal(confirm.props.required, true);
    assert.equal(confirm.props.value, 'yes');
    const details = ui.find((node) => node.type === 'details').props.ref.current;
    let focused = false;
    details.open = true;
    details.querySelector = () => ({
      focus: () => {
        focused = true;
      },
    });
    ui.find((node) => node.type === 'button' && node.props.children === 'Cancel').props.onClick();
    assert.equal(details.open, false);
    assert.equal(focused, true);
  } finally {
    ui.close();
  }
  const { DeletePeopleControl } = load(controls, {
    ...actionMocks,
    '@/components/ui/action-form': {
      ActionForm: ({ children }) => React.createElement('form', null, children),
    },
    '@/components/ui/submit-button': {
      SubmitButton: ({ children }) => React.createElement('button', null, children),
    },
  });
  const html = renderToStaticMarkup(
    React.createElement(DeletePeopleControl, { people, bulk: true }),
  );
  for (const person of people) assert.ok(html.includes(person.name) && html.includes(person.email));
  assert.match(
    html,
    /login account, profiles, tickets, chats and equipment history will be retained/,
  );
  assert.doesNotMatch(html, /<details[^>]* open/);
});
