'use client';

import { useEffect } from 'react';

import { createClient } from '@/lib/supabase/client';

/** Postgres Changes uses table RLS; this channel carries no broadcast or presence data. */
export function useLiveNotifications(organizationId: string, userId: string, refresh: () => void) {
  useEffect(() => {
    let disposed = false;
    const supabase = createClient();
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
    void supabase.realtime
      .setAuth()
      .then(() => {
        if (!disposed)
          channel.subscribe((status) => {
            if (!disposed && status === 'SUBSCRIBED') refresh();
          });
      })
      .catch(() => {
        /* Focus and polling remain available if the subscription cannot connect. */
      });
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [organizationId, userId, refresh]);
}
