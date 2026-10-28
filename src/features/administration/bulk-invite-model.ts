import type { AppRole } from '@/types/database';

export type BulkInviteRow = { email: string; displayName: string; role: AppRole; token: string };
export const bulkInviteLimit = 100;
export function invitationValues(value: unknown): Omit<BulkInviteRow, 'token'> | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.email !== 'string' ||
    typeof item.displayName !== 'string' ||
    typeof item.role !== 'string'
  )
    return null;
  const email = item.email.trim().toLowerCase(),
    displayName = item.displayName.trim();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !displayName ||
    displayName.length > 120 ||
    !['end_user', 'technician', 'administrator'].includes(item.role)
  )
    return null;
  return { email, displayName, role: item.role as AppRole };
}
