'use client';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { formatTimestamp, TIMEZONE_COOKIE, validTimezone } from './model';
const TimezoneContext = createContext('UTC');
export function TimezoneProvider({ timeZone, preference, children }: { timeZone: string; preference: string | null; children: ReactNode }) {
  const router = useRouter();
  const attempted = useRef(false);
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!validTimezone(detected)) return;
    document.cookie = `${TIMEZONE_COOKIE}=${detected}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
    if (!preference && detected !== timeZone && !attempted.current) { attempted.current = true; router.refresh(); }
  }, [preference, timeZone, router]);
  return <TimezoneContext value={timeZone}>{children}</TimezoneContext>;
}
export const useTimezone = () => useContext(TimezoneContext);
export function Timestamp({ value }: { value: string | null }) {
  const zone = useTimezone();
  return <span title={zone} aria-label={`${formatTimestamp(value, zone)} (${zone})`}>{formatTimestamp(value, zone)}</span>;
}
