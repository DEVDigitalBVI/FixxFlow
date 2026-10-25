'use client';

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';

function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi,
      '/[id]',
    );
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}

export function WebAnalytics() {
  return <Analytics beforeSend={beforeSend} debug={false} />;
}
