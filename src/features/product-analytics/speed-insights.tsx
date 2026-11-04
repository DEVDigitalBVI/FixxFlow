'use client';

import { SpeedInsights } from '@vercel/speed-insights/next';
import type { ComponentProps } from 'react';

const beforeSend: NonNullable<ComponentProps<typeof SpeedInsights>['beforeSend']> = (event) => {
  try {
    const url = new URL(event.url);
    url.search = '';
    url.hash = '';
    return { ...event, url: url.href };
  } catch {
    return null;
  }
};

export function PrivateSpeedInsights() {
  return <SpeedInsights beforeSend={beforeSend} debug={false} />;
}
