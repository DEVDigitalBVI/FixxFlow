import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { load } from '../../../tests/helpers/load-module.mjs';
import { searchNavigation } from '../../../tests/helpers/search-navigation.mjs';

const asset = { id: 'asset-a', name: 'Reception laptop', tag: 'PC-001', kind: 'computer', status: 'repair', model: 'Example notebook', serial_number: '012345', revision: 3 };
const mocks = {
  'next/link': { default: props => React.createElement('a', props) },
  'next/navigation': searchNavigation,
  '@/features/assets/ticket-link-form': { AssetLinkForm: props => React.createElement('button', { 'data-ticket': props.ticketId }, 'Link to ticket') },
};
function inventory({ role = 'administrator', rows = [asset], count = rows.length, error = null } = {}) {
  const calls = [];
  const chain = table => new Proxy({}, { get: (_, key) => key === 'then' ? resolve => Promise.resolve(table === 'tickets' ? { data: { id: 'ticket-a', ticket_number: 42 } } : { data: rows, count, error }).then(resolve) : (...args) => { calls.push([table, key, ...args]); return chain(table); } });
  const Page = load('src/app/app/assets/page.tsx', { ...mocks,
    '@/lib/auth/viewer': { requireViewer: async () => ({ role, id: 'employee-a', organizationId: 'org-a', organizationName: 'Example workspace' }) },
    '@/lib/supabase/server': { createClient: async () => ({ from: chain, rpc: name => chain(name) }) },
  }).default;
  return { calls, render: async (params = {}) => render(await Page({ searchParams: Promise.resolve(params) })) };
}

test('inventory groups count, filters, complete asset identity and named Open controls', async () => {
  const html = await inventory().render();
  for (const text of ['Assets', 'Your inventory', '1 asset', 'Most recently updated first', 'Add asset', 'Import spreadsheet', 'PC-001', '012345', 'Under repair']) assert.ok(html.includes(text));
  assert.match(html, /aria-labelledby="inventory-heading"/);
  assert.match(html, /class="button button-secondary" href="\/app\/assets\/asset-a">Open<span class="sr-only"> Reception laptop/);
  assert.match(html, /table responsive-table table-nowrap/);
  assert.match(html, /aria-label="Asset pages"/);
});
test('lifecycle presentation always includes the authoritative written label', () => {
  const { AssetStatusBadge } = load('src/features/assets/asset-status-badge.tsx');
  for (const [status, label] of Object.entries({ available: 'Available', in_use: 'In use', repair: 'Under repair', retired: 'Retired' })) {
    const html = render(React.createElement(AssetStatusBadge, { status }));
    assert.ok(html.includes(label)); assert.match(html, /aria-hidden="true"/);
  }
});
test('empty inventory, filtered results, past-end pages and failures offer relevant recovery', async () => {
  const empty = inventory({ rows: [] });
  assert.match(await empty.render(), /Add your first asset/);
  assert.match(await empty.render({ status: 'repair' }), /No matching assets/);
  assert.match(await empty.render({ q: 'unknown' }), /Clear filters/);
  assert.match(await empty.render({ page: '3' }), /No assets on this page/);
  const failure = await inventory({ error: { message: 'private error detail' } }).render();
  assert.match(failure, /Inventory unavailable/); assert.match(failure, /Try again/);
  assert.doesNotMatch(failure, /private error detail|1 asset|Asset pages/);
});
test('employee inventory preserves simpler presentation and assignment scope', async () => {
  const page = inventory({ role: 'end_user', rows: [] }); const html = await page.render();
  assert.match(html, /My equipment/); assert.match(html, /No equipment assigned/);
  assert.doesNotMatch(html, /Add asset|Import spreadsheet|Add your first/);
  assert.ok(page.calls.some(c => c[1] === 'eq' && c[2] === 'assigned_user_id' && c[3] === 'employee-a'));
  assert.ok(page.calls.some(c => c[1] === 'eq' && c[2] === 'organization_id' && c[3] === 'org-a'));
});
test('ticket linking survives search, clear filters and pagination without changing action authority', async () => {
  const ticket = '11111111-1111-4111-8111-111111111111';
  const html = await inventory({ count: 60 }).render({ ticket, q: 'PC', status: 'repair', page: '2' });
  assert.match(html, /Link equipment to Ticket #42/); assert.match(html, /data-ticket="ticket-a"/);
  assert.ok(html.includes(`q=PC&amp;status=repair&amp;page=3&amp;ticket=${ticket}`));
  assert.ok(html.includes(`href="/app/assets?ticket=${ticket}">Clear filters`));
  const employee = await inventory({ role: 'end_user' }).render({ ticket });
  assert.doesNotMatch(employee, /Link to ticket|Back to ticket|name="ticket"/);
});
test('asset editor groups all existing fields and preserves drafts and focused errors', () => {
  let focused = false; const effects = [];
  const { AssetForm } = load('src/features/assets/asset-form.tsx', { ...mocks,
    react: { ...React, useState: value => [value, () => {}], useActionState: () => [{ error: 'This asset changed. Review and try again.' }, () => {}], useRef: () => ({ current: { focus: () => { focused = true; } } }), useEffect: fn => effects.push(fn) },
    '@/app/app/assets/actions': { saveAsset: () => {} },
    '@/components/ui/submit-button': { SubmitButton: props => React.createElement('button', props) },
  });
  const html = render(React.createElement(AssetForm, { asset, people: [], locations: [] }));
  for (const label of ['Identity', 'Assignment &amp; lifecycle', 'Purchase &amp; warranty']) assert.ok(html.includes(`<legend>${label}</legend>`));
  for (const name of ['tag', 'name', 'kind', 'status', 'model', 'serial_number', 'assigned_user_id', 'location_id', 'purchased_on', 'warranty_until']) assert.ok(html.includes(`name="${name}"`));
  assert.match(html, /value="Reception laptop"/); assert.match(html, /value="012345"/);
  assert.match(html, /tabindex="-1" class="alert alert-error" role="alert"/);
  assert.match(html, /Save asset/); assert.match(html, /Retirement preserves/);
  effects.forEach(fn => fn()); assert.equal(focused, true);
});

test('asset detail uses a shared heading, lifecycle text and named ticket history actions', async () => {
  async function detail(role) {
    const chain = table => new Proxy({}, { get: (_, key) => key === 'then' ? resolve => Promise.resolve({ data: table === 'assets' ? asset : table === 'ticket_assets' ? [{ ticket_id: 'ticket-a' }] : [{ id: 'ticket-a', ticket_number: 42, title: 'Replace keyboard' }], error: null }).then(resolve) : () => chain(table) });
    const Page = load('src/app/app/assets/[assetId]/page.tsx', { ...mocks,
      '@/lib/auth/viewer': { requireViewer: async () => ({ role, organizationId: 'org-a', usageSharing: false }) },
      '@/lib/supabase/server': { createClient: async () => ({ from: chain }) },
      '@/features/assets/options': { assetOptions: async () => ({ people: [], locations: [] }) },
      '@/features/assets/asset-form': { AssetForm: () => React.createElement('form', { 'aria-label': 'Edit asset' }) },
      '@/features/product-analytics/usage-event': { UsageEvent: () => null },
    }).default;
    return render(await Page({ params: Promise.resolve({ assetId: asset.id }), searchParams: Promise.resolve({ saved: '1' }) }));
  }
  const staff = await detail('technician');
  assert.match(staff, /<h1>Reception laptop<\/h1>/); assert.match(staff, /Under repair/);
  assert.match(staff, /role="status">Asset saved/); assert.match(staff, /Open ticket<span class="sr-only"> #42/);
  const employee = await detail('end_user');
  assert.match(employee, /Get help with this equipment/); assert.match(employee, /Equipment details/);
  assert.doesNotMatch(employee, /Edit asset|Ticket history|Replace keyboard/);
});
