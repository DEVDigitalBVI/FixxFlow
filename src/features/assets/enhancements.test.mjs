import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';

import { load } from '../../../tests/helpers/load-module.mjs';

const mocks = {
  'next/link': { default: (props) => React.createElement('a', props) },
  '@/components/ui/action-form': {
    ActionForm: ({ children }) => React.createElement('form', null, children),
  },
  '@/components/ui/submit-button': {
    SubmitButton: ({ children }) => React.createElement('button', { type: 'submit' }, children),
  },
  '@/app/app/inventory/actions': { setReorderThreshold() {} },
};
test('low-stock settings use native labeled numeric controls with explicit disable guidance', () => {
  const { ReorderSettings } = load('src/features/inventory/reorder-settings.tsx', mocks);
  const html = render(
    React.createElement(ReorderSettings, { item: { id: 'item', reorder_threshold: 0 } }),
  );
  assert.match(html, /<summary>Low-stock alerts/);
  assert.match(html, /<label>Reorder when/);
  assert.match(html, /<input[^>]*min="0"[^>]*name="threshold"/);
  assert.match(html, /Leave blank to turn alerts off/);
  assert.match(html, /value="0"/);
  assert.match(html, /Inventory managers/);
  const { InventoryTable } = load('src/features/inventory/inventory-table.tsx', mocks);
  const item = {
    id: 'item',
    name: 'Toner',
    department_name: 'Office',
    location_name: 'Store',
    kind: 'consumable',
    stock: 5,
    reserved: 3,
    reorder_threshold: 2,
  };
  const table = render(React.createElement(InventoryTable, { items: [item] }));
  assert.match(table, /Low stock/);
  assert.match(table, /data-label="Available">2/);
  assert.match(table, /tabindex="0"/);
});
test('threshold action validates integers and capabilities before using the viewer-scoped RPC', async () => {
  let manager = true,
    calls = [];
  const { setReorderThreshold } = load('src/app/app/inventory/actions.ts', {
    'next/cache': { revalidatePath() {} },
    '@/lib/auth/viewer': {
      requireViewer: async () => ({ organizationId: 'verified-org', role: 'technician' }),
    },
    '@/features/inventory/access': { inventoryAccess: async () => ({ manager }) },
    '@/lib/supabase/server': {
      createClient: async () => ({
        rpc: async (name, args) => {
          calls.push([name, args]);
          return { error: null };
        },
      }),
    },
  });
  const form = new FormData();
  form.set('id', '11111111-1111-4111-8111-111111111111');
  form.set('threshold', '1.5');
  assert.ok((await setReorderThreshold(form)).error);
  assert.equal(calls.length, 0);
  form.set('threshold', '0');
  form.set('expected', '');
  assert.ok((await setReorderThreshold(form)).success);
  assert.equal(calls[0][1].org, 'verified-org');
  assert.equal(calls[0][1].threshold, 0);
  assert.equal(calls[0][1].expected, null);
  manager = false;
  assert.ok((await setReorderThreshold(form)).error);
  assert.equal(calls.length, 1);
});
test('equipment reminders require cron authentication and return safe bounded results', async () => {
  let authorized = false,
    fail = false,
    calls = 0;
  const { GET } = load('src/app/api/cron/equipment/route.ts', {
    '@/lib/cron-auth': { isCronAuthorized: () => authorized },
    '@/lib/server-errors': { reportServerError: () => 'reference' },
    '@/lib/supabase/admin': {
      createAdminClient: () => {
        calls++;
        return {
          rpc: async (name, args) => {
            assert.equal(name, 'process_equipment_reminders');
            assert.deepEqual(args, { batch_size: 100 });
            return fail ? { error: new Error('secret') } : { data: 3 };
          },
        };
      },
    },
  });
  const request = new Request('https://example.test/api/cron/equipment');
  assert.equal((await GET(request)).status, 401);
  assert.equal(calls, 0);
  authorized = true;
  const response = await GET(request);
  assert.deepEqual(await response.json(), { checked: 3 });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  fail = true;
  const error = await GET(request);
  assert.equal(error.status, 500);
  assert.doesNotMatch(await error.text(), /secret/);
});
test('equipment notification links stay on the correct feature and emails retain useful fallback destinations', () => {
  const { notificationHref } = load('src/features/notifications/presentation.ts');
  const base = { ticket_id: null, conversation_id: null };
  assert.equal(notificationHref({ ...base, asset_id: 'asset' }), '/app/assets/asset');
  assert.equal(notificationHref({ ...base, inventory_item_id: 'stock' }), '/app/inventory/stock');
  assert.equal(notificationHref({ ...base, email_kind: 'asset_lifecycle' }), '/app/assets');
  assert.equal(notificationHref({ ...base, email_kind: 'inventory_low_stock' }), '/app/inventory');
});
