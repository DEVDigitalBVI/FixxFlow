'use client';

import { useRouteRefresh } from '@/lib/realtime/use-route-refresh';

/** Refresh while visible and on return, without remounting request forms. */
export function AnnouncementRefresh() {
  useRouteRefresh(60000);
  return null;
}
