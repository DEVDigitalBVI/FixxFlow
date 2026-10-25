'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { createClient } from '@/lib/supabase/client';

import { useLiveNotifications } from './use-live-notifications';

export function NotificationLink({
  organizationId,
  userId,
  className,
  onNavigate,
}: {
  organizationId: string;
  userId: string;
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);
  const [supabase] = useState(createClient);
  const requestVersion = useRef({ value: 0 });
  const refresh = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    const version = ++requestVersion.current.value;
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('recipient_id', userId)
        .is('read_at', null);
      if (version === requestVersion.current.value) setCount(error ? null : count);
    } catch {
      if (version === requestVersion.current.value) setCount(null);
    }
  }, [supabase, organizationId, userId]);
  useLiveNotifications(organizationId, userId, refresh);
  useEffect(() => {
    const version = requestVersion.current;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', refresh);
    window.addEventListener('notifications-changed', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      version.value++;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('notifications-changed', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refresh, pathname]);
  const label = `Notifications${count ? `, ${count} unread` : ''}`;
  return (
    <Link
      href="/app/notifications"
      className={className}
      aria-label={label}
      title={label}
      aria-current={pathname === '/app/notifications' ? 'page' : undefined}
      onClick={onNavigate}
    >
      <NavigationIcon name="notifications" />
      <span>
        Notifications
        {count ? <b className="notification-count">{count > 99 ? '99+' : count}</b> : null}
      </span>
    </Link>
  );
}
