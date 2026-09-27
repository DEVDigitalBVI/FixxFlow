'use client';

import { useRouteRefresh } from '@/lib/realtime/use-route-refresh';

export function ConversationRefresh() {
  useRouteRefresh();
  return null;
}
