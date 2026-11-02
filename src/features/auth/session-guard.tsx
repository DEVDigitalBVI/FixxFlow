'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { RouteError } from '@/components/route-error';
import { Button } from '@/components/ui/button';
import { allowSessionExit } from '@/components/ui/unsaved-changes';
import { createClient } from '@/lib/supabase/client';

import { createSessionController } from './session-controller';
import { SessionWarning } from './session-warning';

export function postSignOut() {
  allowSessionExit();
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/auth/sign-out';
  document.body.append(form);
  form.submit();
}
export function SessionGuard({ userId, children }: { userId: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [remaining, setRemaining] = useState(Number.POSITIVE_INFINITY);
  const [extending, setExtending] = useState(false);
  const stay = useRef<() => Promise<void>>(async () => {});
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    const hide = () => {
      if (root.current) root.current.style.display = 'none';
    };
    let channel: BroadcastChannel | undefined;
    const controller = createSessionController({
      userId,
      now: Date.now,
      request: async (active) => {
        const response = await fetch('/auth/session', {
          method: active ? 'POST' : 'GET',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (response.status >= 500 || response.status === 403)
          throw Error('Session verification unavailable');
        return response.json();
      },
      remaining: setRemaining,
      hide,
      verified: () => {
        setBlocked(false);
        if (root.current) root.current.style.display = 'contents';
      },
      unavailable: () => setBlocked(true),
      expired: postSignOut,
      changed: () => {
        allowSessionExit();
        window.location.reload();
      },
      renewed: () => channel?.postMessage({ type: 'activity', userId }),
    });
    const check = () => controller.check();
    retry.current = () => void check();
    stay.current = async () => {
      setExtending(true);
      await controller.check(true);
      setExtending(false);
    };
    const activity = (event: Event) => {
      if (event.isTrusted && document.visibilityState === 'visible') controller.activity();
    };
    const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
    for (const name of activityEvents) window.addEventListener(name, activity, { passive: true });
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) {
        hide();
        allowSessionExit();
        window.location.reload();
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') {
        hide();
        void check();
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key?.startsWith('sb-')) {
        hide();
        void check();
      }
    };
    try {
      channel = new BroadcastChannel('fixxflow-session');
      channel.onmessage = (event) => {
        if (
          ['signed-out', 'activity'].includes(event.data?.type) &&
          (!event.data.userId || event.data.userId === userId)
        ) {
          if (event.data.type === 'signed-out') hide();
          void check();
        }
      };
    } catch {}
    const auth = createClient().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        hide();
        void check();
      }
    });
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restored);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(() => controller.tick(), 1000);
    void check();
    return () => {
      controller.stop();
      for (const name of activityEvents) window.removeEventListener(name, activity);
      clearInterval(timer);
      channel?.close();
      auth.data.subscription.unsubscribe();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', restored);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [userId]);
  return (
    <>
      <div ref={root} hidden={blocked} style={blocked ? undefined : { display: 'contents' }}>
        {children}
      </div>
      <SessionWarning
        remaining={remaining}
        blocked={blocked}
        extending={extending}
        onStay={() => void stay.current()}
        onSignOut={postSignOut}
      />
      {blocked && (
        <main>
          <RouteError
            retry={() => retry.current()}
            title="Session verification unavailable"
            message="We couldn’t verify your session. Your unfinished work is still in this tab. Retry to continue, or sign out."
            back={undefined}
          />
          <Button variant="secondary" onClick={postSignOut}>
            Sign out
          </Button>
        </main>
      )}
    </>
  );
}
