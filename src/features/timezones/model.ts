export const TIMEZONE_COOKIE = 'fixxflow-timezone';
export function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || (value !== 'UTC' && !value.includes('/')) || value.length > 100) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}
export function resolveTimezone(preference: unknown, device: unknown, organization: unknown): string {
  return [preference, device, organization].find(validTimezone) ?? 'UTC';
}
export function formatTimestamp(value: string | null, timeZone: string) {
  return value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(value)) : 'Not set';
}
