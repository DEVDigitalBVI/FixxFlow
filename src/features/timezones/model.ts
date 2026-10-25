export const TIMEZONE_COOKIE = 'fixxflow-timezone';
export function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || (value !== 'UTC' && !value.includes('/')) || value.length > 100)
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
export function resolveTimezone(
  preference: unknown,
  device: unknown,
  organization: unknown,
): string {
  return [preference, device, organization].find(validTimezone) ?? 'UTC';
}
/** Short age for scanning lists ("5m ago"); pair with the exact timestamp for detail. */
export function formatRelativeAge(value: string, now: number, timeZone: string) {
  const elapsed = now - Date.parse(value);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const sameYear =
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(new Date(value)) ===
    new Intl.DateTimeFormat('en', { year: 'numeric', timeZone }).format(new Date(now));
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone,
  }).format(new Date(value));
}

export function formatTimestamp(value: string | null, timeZone: string) {
  return value
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
        new Date(value),
      )
    : 'Not set';
}
