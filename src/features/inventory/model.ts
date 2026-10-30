import type { BadgeTone } from '@/components/ui/badge';
import type { InventoryState } from '@/types/inventory-database';

export const inventoryStates: Record<InventoryState, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Pending review', tone: 'neutral' },
  needs_information: { label: 'More information needed', tone: 'warning' },
  approved: { label: 'Approved · stock reserved', tone: 'active' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled · reservation released', tone: 'neutral' },
  issued: { label: 'Issued · fulfilled', tone: 'success' },
};
export function quantity(value: FormDataEntryValue | null, correction = false): number | null {
  const raw = String(value ?? '');
  if (!(correction ? /^-?[1-9]\d*$/ : /^[1-9]\d*$/).test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && Math.abs(parsed) <= 2147483647 ? parsed : null;
}
export function contextLabel(context: unknown, key: string): string {
  return context &&
    typeof context === 'object' &&
    key in context &&
    typeof (context as Record<string, unknown>)[key] === 'string'
    ? String((context as Record<string, unknown>)[key])
    : '';
}
