'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouteRefresh } from '@/lib/realtime/use-route-refresh';

/** Acknowledge only updates covered by the loaded server snapshot and visible thread. */
export function ChatReadUpdates({ conversationId, organizationId, viewerId, through, active }: {
  conversationId: string; organizationId: string; viewerId: string; through: string; active: boolean;
}) {
  const [supabase] = useState(createClient);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useRouteRefresh(60000);
  useEffect(() => {
    if (!active) return;
    let disposed = false, inFlight = false;
    async function acknowledge() {
      if (document.visibilityState !== 'visible' || disposed || inFlight) return;
      inFlight = true;
      try {
        const { data, error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
          .eq('organization_id', organizationId).eq('recipient_id', viewerId).eq('conversation_id', conversationId)
          .is('read_at', null).lte('created_at', through).select('id');
        if (disposed) return;
        setFailed(Boolean(error));
        if (!error && data?.length) {
          window.dispatchEvent(new Event('notifications-changed'));
          refresh();
        }
      } catch { if (!disposed) setFailed(true); }
      finally { inFlight = false; }
    }
    void acknowledge();
    window.addEventListener('focus', acknowledge);
    document.addEventListener('visibilitychange', acknowledge);
    return () => { disposed = true; window.removeEventListener('focus', acknowledge); document.removeEventListener('visibilitychange', acknowledge); };
  }, [active, conversationId, organizationId, viewerId, through, supabase, attempt, refresh]);
  return failed ? <p className="chat-read-error" role="status">Unread updates could not be cleared. <button type="button" className="button button-quiet" onClick={() => setAttempt(value => value + 1)}>Retry</button></p> : null;
}
