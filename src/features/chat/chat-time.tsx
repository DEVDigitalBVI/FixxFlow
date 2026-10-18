'use client';

import { useTimezone } from '@/features/timezones/provider';
import { formatTimestamp } from '@/features/timezones/model';

/** Keep scanning compact while retaining the exact date and timezone for every message. */
export function ChatTime({ value, variant = 'message' }: { value: string; variant?: 'message' | 'inbox' }) {
  const timeZone = useTimezone();
  const full = `${formatTimestamp(value, timeZone)} (${timeZone})`;
  const options: Intl.DateTimeFormatOptions = variant === 'inbox'
    ? { month: 'short', day: 'numeric', timeZone }
    : { hour: 'numeric', minute: '2-digit', timeZone };
  return <time dateTime={value} title={full} aria-label={full}>{new Intl.DateTimeFormat('en', options).format(new Date(value))}</time>;
}
