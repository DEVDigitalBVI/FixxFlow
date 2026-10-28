'use client';

import { useEffect, useState } from 'react';

import { SUPPORT_HOURS, withinSupportHours } from '@/features/tickets/business-hours';

export function ChatSupportHours({
  timeZone = 'UTC',
  initialAt,
}: {
  timeZone?: string;
  initialAt?: number;
}) {
  const [at, setAt] = useState(initialAt);
  useEffect(() => {
    const initial = window.setTimeout(() => setAt(Date.now()), 0);
    const timer = window.setInterval(() => setAt(Date.now()), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  const covered = at === undefined || withinSupportHours(at, timeZone);
  return (
    <div className="chat-support-hours" role="status">
      {!covered && <p>IT is offline. Leave a message and we’ll follow up.</p>}
      <p className="muted">
        Support hours: {SUPPORT_HOURS} · {timeZone}
      </p>
    </div>
  );
}
