'use client';

import { useCallback, useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** Coalesce realtime bursts and keep only one background route transition active. */
export function useRouteRefresh(intervalMs = 30000) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inFlight.current = pending; }, [pending]);
  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible' || timer.current !== null || inFlight.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (document.visibilityState !== 'visible' || inFlight.current) return;
      inFlight.current = true;
      startTransition(() => router.refresh());
    }, 250);
  }, [router, startTransition]);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(refresh, intervalMs);
    return () => clearInterval(interval);
  }, [refresh, intervalMs]);

  return refresh;
}
