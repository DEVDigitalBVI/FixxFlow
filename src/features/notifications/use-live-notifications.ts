'use client';

import { useEffect } from 'react';

import { loadBrowserClient } from '@/lib/supabase/lazy-client';

/** Postgres Changes uses table RLS; this channel carries no broadcast or presence data. */
export function useLiveNotifications(organizationId: string, userId: string, refresh: () => void) {
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    // The SDK loads after the page is interactive; focus and polling cover the gap.
    loadBrowserClient()
      .then((supabase) => {
        if (disposed) return;
        const channel = supabase
          .channel(`notifications:${organizationId}:${userId}:${crypto.randomUUID()}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'notifications',
              filter: `recipient_id=eq.${userId}`,
            },
            () => {
              if (!disposed) refresh();
            },
          );
        unsubscribe = () => void supabase.removeChannel(channel);
        return supabase.realtime.setAuth().then(() => {
          if (!disposed)
            channel.subscribe((status) => {
              if (!disposed && status === 'SUBSCRIBED') refresh();
            });
        });
      })
      .catch(() => {
        /* Focus and polling remain available if the subscription cannot connect. */
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [organizationId, userId, refresh]);
}
