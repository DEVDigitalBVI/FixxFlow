/** Manual ticket deadlines use the pilot workspace's BVI time, independent of the host/browser. */
export const TICKET_TIMEZONE = 'America/Tortola';
export const TICKET_TIMEZONE_LABEL = 'British Virgin Islands time (UTC−4)';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TICKET_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function deadlineInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** null clears a deadline; undefined identifies malformed or impossible local dates. */
export function parseDeadline(value: string): string | null | undefined {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || value.startsWith('0000')) return undefined;
  // Tortola uses UTC−4 year-round. The explicit offset never depends on process TZ.
  const date = new Date(`${value}:00-04:00`);
  if (!Number.isFinite(date.getTime()) || deadlineInputValue(date.toISOString()) !== value) return undefined;
  return date.toISOString();
}
