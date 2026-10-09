import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';
import { searchNavigation } from '../../../tests/helpers/search-navigation.mjs';

const mocks = {
  'next/link': { default: props => React.createElement('a', props) },
  'next/navigation': { ...searchNavigation, notFound() { throw Error('NOT_FOUND'); } },
  '@/features/administration/member-details-editor': { MemberDetailsEditor: props => React.createElement('div', { 'data-inline-editor': props.inline }, 'Profile editor') },
  './actions': { inviteMember: async () => {}, updateMemberRole: async () => {}, updateMemberStatus: async () => {} },
};
const { PersonCard } = load('src/features/administration/person-card.tsx', mocks);
const person = { id: 'user-1', name: 'Alex Rivers', email: 'alex@example.invalid', role: 'technician', status: 'active', isSelf: false, canManage: true, profile: { user_id: 'user-1', job_title: 'Support specialist', department_id: null, location_id: null, updated_at: '2026-10-01' }, departments: [], locations: [], updateRole: async () => {}, updateStatus: async () => {} };

test('directory presents identity, job, role and written status before collapsed management', () => {
  const html = render(React.createElement(PersonCard, person));
  for (const text of ['Alex Rivers', 'alex@example.invalid', 'Support specialist', 'Technician', 'Active', 'Manage', 'Workspace access', 'Profile details']) assert.ok(html.includes(text));
  assert.match(html, /<details class="person-manage"><summary class="button button-secondary">/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /data-inline-editor="true"/);
  assert.match(html, /<label for="role-user-1">Role for Alex Rivers/);
});
test('access changes require a separate contextual confirmation; own deactivation is unavailable', () => {
  const html = render(React.createElement(PersonCard, person));
  assert.match(html, /Deactivate Alex Rivers’s workspace access/);
  assert.match(html, /Confirm deactivation/);
  assert.match(html, /name="status" value="inactive"/);
  const own = render(React.createElement(PersonCard, { ...person, isSelf: true }));
  assert.match(own, /You can’t deactivate your own account/);
  assert.doesNotMatch(own, /name="status"|Confirm deactivation/);
  assert.match(own, /person-self">You/);
  const inactive = render(React.createElement(PersonCard, { ...person, status: 'inactive' }));
  assert.match(inactive, /Restore Alex Rivers’s workspace access/); assert.match(inactive, /name="status" value="active"/);
});
test('inventory access follows profile and workspace access, within the existing management disclosure', () => {
  const html = render(React.createElement(PersonCard, { ...person, inventoryPermissions: React.createElement('section', {className: 'person-inventory-access'}, 'Inventory access') }));
  assert.ok(html.indexOf('Profile details') < html.indexOf('Workspace access'));
  assert.ok(html.indexOf('Workspace access') < html.indexOf('Inventory access'));
  const readOnly = render(React.createElement(PersonCard, { ...person, canManage: false, inventoryPermissions: 'Inventory access' }));
  assert.doesNotMatch(readOnly, /Inventory access/);
});
test('read-only directory exposes no role/status forms or management controls', () => {
  const html = render(React.createElement(PersonCard, { ...person, canManage: false }));
  assert.match(html, /Technician/); assert.match(html, /Active/);
  assert.doesNotMatch(html, /<form|<details|Manage|Profile editor/);
});
test('incomplete profiles and long user text remain safe readable content', () => {
  const html = render(React.createElement(PersonCard, { ...person, profile: undefined, name: '<script>not code</script>' }));
  assert.match(html, /finishes setting up their account/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>not code/);
});

function page(role = 'administrator', count = 0, error = null) {
  const calls = [];
  const chain = new Proxy({}, { get: (_, key) => key === 'then' ? resolve => Promise.resolve({ data: [], count, error }).then(resolve) : (...args) => { calls.push([key, ...args]); return chain; } });
  const Page = load('src/app/app/people/page.tsx', { ...mocks,
    '@/lib/auth/viewer': { requireViewer: async () => ({ role, organizationId: 'organization-a', organizationName: 'Example workspace', id: 'self' }) },
    '@/lib/supabase/server': { createClient: async () => ({ from: () => chain, rpc: () => chain }) },
  }).default;
  return { calls, render: async filters => render(await Page({ searchParams: Promise.resolve(filters ?? {}) })) };
}
test('people header keeps invitation behind a clear action and preserves active list context', async () => {
  const html = await page().render({ q: 'Alex', view: 'technicians', page: '2' });
  assert.match(html, /<h1>Technicians<\/h1>/); assert.match(html, /Invite member/);
  assert.doesNotMatch(html, /id="invite-name"/);
  assert.match(html, /q=Alex&amp;view=technicians&amp;page=2&amp;invite=1#invite-member/);
  assert.match(html, /aria-current="page">Technicians/);
});
test('invitation view uses labeled native fields, technician default, focus and cancel', async () => {
  const html = await page().render({ invite: '1', view: 'technicians', q: 'Alex' });
  for (const text of ['Invite someone to FixxFlow', 'Full name', 'Work email', 'Workspace role', 'Send invitation', 'Cancel']) assert.ok(html.includes(text));
  assert.match(html, /id="invite-name"[^>]*autofocus/);
  assert.match(html, /<option value="technician" selected="">/);
  assert.match(html, /href="\/app\/people\?q=Alex&amp;view=technicians">Cancel/);
});
test('empty, search and technician states explain different next steps', async () => {
  assert.match(await page().render(), /Bring your people together/);
  assert.match(await page().render({ q: 'none' }), /No people match your search/);
  assert.match(await page().render({ view: 'technicians' }), /No technicians here yet/);
  assert.match(await page().render({ page: '3' }), /No people on this page/);
});
test('read authorization, query scope, paging and failures remain server enforced', async () => {
  await assert.rejects(page('end_user').render(), /NOT_FOUND/);
  const readOnly = await page('technician').render({ invite: '1' });
  assert.doesNotMatch(readOnly, /Invite member|invite-name|Back to Administration/);
  const directory = page('administrator', 60); const html = await directory.render({ page: '2', q: 'Alex', view: 'technicians' });
  assert.ok(directory.calls.some(c => c[0] === 'eq' && c[1] === 'organization_id' && c[2] === 'organization-a'));
  assert.ok(directory.calls.some(c => c[0] === 'range' && c[1] === 25 && c[2] === 49));
  assert.match(html, /page=3&amp;q=Alex&amp;view=technicians/);
  await assert.rejects(page('administrator', 0, { message: 'offline' }).render(), /Unable to load members/);
});
