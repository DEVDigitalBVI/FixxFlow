import { validTimezone } from '@/features/timezones/model';

/** The explicit zone is pinned to the form draft, never inferred by the server. */
export function deadlineInputValue(value: string | null, timeZone: string): string {
  if (!value || !validTimezone(timeZone)) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Round-trip every offset near this date, including half-hour DST transitions. */
export function deadlineCandidates(value: string, timeZone: string): string[] {
  if (!validTimezone(timeZone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) || value.startsWith('0000')) return [];
  const nominal = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(nominal)) return [];
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const instant = nominal + hours * 3600000;
    const local = deadlineInputValue(new Date(instant).toISOString(), timeZone);
    offsets.add(Date.parse(`${local}:00Z`) - instant);
  }
  return [...offsets].map(offset => new Date(nominal - offset).toISOString())
    .filter(instant => deadlineInputValue(instant, timeZone) === value).sort();
}

/** Ambiguous fall-back times require an explicit earlier/later occurrence. */
export function parseDeadline(value: string, timeZone: string, occurrence = ''): string | null | undefined {
  if (!validTimezone(timeZone)) return undefined;
  if (!value) return null;
  const candidates = deadlineCandidates(value, timeZone);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && occurrence === 'earlier') return candidates[0];
  if (candidates.length > 1 && occurrence === 'later') return candidates.at(-1);
  return undefined;
}
