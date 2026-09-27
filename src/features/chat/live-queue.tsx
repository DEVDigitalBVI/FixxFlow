'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouteRefresh } from '@/lib/realtime/use-route-refresh';

export function LiveChatQueue({ organizationId }: { organizationId: string }) {
  const [connected, setConnected] = useState(false);
  const refresh = useRouteRefresh(connected ? 60000 : 20000);
  useEffect(() => {
    let disposed = false;
    const supabase = createClient();
    const channel = supabase.channel(`chat-queue:${organizationId}`, { config: { private: true } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations', filter: `organization_id=eq.${organizationId}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `organization_id=eq.${organizationId}` }, refresh);
    void supabase.realtime.setAuth().then(() => {
      if (disposed) return;
      channel.subscribe(status => {
        if (disposed) return;
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') refresh();
      });
    }).catch(() => { if (!disposed) setConnected(false); });
    return () => { disposed = true; void supabase.removeChannel(channel); };
  }, [organizationId, refresh]);
  return <span className="chat-connection" role="status">{connected ? 'Live queue' : 'Refreshing queue'}</span>;
}
