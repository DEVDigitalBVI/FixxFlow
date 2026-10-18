'use client';
import { useRouteRefresh } from '@/lib/realtime/use-route-refresh';
import { useLiveNotifications } from './use-live-notifications';
export function LiveNotifications({ organizationId, userId }: { organizationId: string; userId: string }) {
  const refresh = useRouteRefresh();
  useLiveNotifications(organizationId, userId, refresh);
  return null;
}
