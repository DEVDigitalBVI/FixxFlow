'use client';

import { useEffect, useRef, useState } from 'react';

/** Per-mounted-picker cache. Never shares private choices across users or requests. */
export function useLazyTicketList<T>(
  url: string,
  initial: T[] | undefined,
  validate: (value: unknown) => value is T[],
) {
  const [items, setItems] = useState<T[]>(initial ?? []);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    initial ? 'ready' : 'idle',
  );
  const ready = useRef(Boolean(initial));
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  async function load() {
    if (ready.current) return true;
    if (controller.current) return false;
    const request = new AbortController();
    controller.current = request;
    setPhase('loading');
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: request.signal,
      });
      if (!response.ok) throw new Error('Choices unavailable');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('items' in data) || !validate(data.items))
        throw new Error('Invalid choices');
      if (request.signal.aborted) return false;
      ready.current = true;
      setItems(data.items);
      setPhase('ready');
      return true;
    } catch {
      if (!request.signal.aborted) setPhase('error');
      return false;
    } finally {
      if (controller.current === request) controller.current = null;
    }
  }
  return { items, phase, load };
}
