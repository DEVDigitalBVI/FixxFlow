import type { InventoryState } from '@/types/inventory-database';
export const inventoryStates: Record<InventoryState, { label: string; tone: string }> = {
 pending: { label: 'Pending review', tone: 'slate' }, needs_information: { label: 'More information needed', tone: 'amber' },
 approved: { label: 'Approved · stock reserved', tone: 'blue' }, declined: { label: 'Declined', tone: 'red' },
 cancelled: { label: 'Cancelled · reservation released', tone: 'slate' }, issued: { label: 'Issued · fulfilled', tone: 'green' },
};
export function quantity(value: FormDataEntryValue | null, correction = false): number | null {
 const raw = String(value ?? '');
 if (!(correction ? /^-?[1-9]\d*$/ : /^[1-9]\d*$/).test(raw)) return null;
 const parsed = Number(raw);
 return Number.isSafeInteger(parsed) && Math.abs(parsed) <= 2147483647 ? parsed : null;
}
export function contextLabel(context: unknown, key: string): string {
 return context && typeof context === 'object' && key in context && typeof (context as Record<string, unknown>)[key] === 'string' ? String((context as Record<string, unknown>)[key]) : '';
}
