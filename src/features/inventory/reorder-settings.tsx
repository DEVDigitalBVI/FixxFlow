'use client';

import { setReorderThreshold } from '@/app/app/inventory/actions';
import { ActionForm } from '@/components/ui/action-form';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import type { InventoryItem } from '@/types/inventory-database';

export function ReorderSettings({ item }: { item: InventoryItem }) {
  return (
    <details className="settings-card">
      <summary>Low-stock alerts</summary>
      <ActionForm action={setReorderThreshold} className="stack">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="expected" value={item.reorder_threshold ?? ''} />
        <label>
          Reorder when available stock reaches
          <Input
            type="number"
            name="threshold"
            min="0"
            max="2147483647"
            step="1"
            defaultValue={item.reorder_threshold ?? ''}
          />
        </label>
        <p className="form-note">
          Available means in storage minus reserved. Leave blank to turn alerts off. Inventory
          managers are notified once while stock stays low; alerts reset after it recovers.
        </p>
        <SubmitButton variant="secondary">Save threshold</SubmitButton>
      </ActionForm>
    </details>
  );
}
