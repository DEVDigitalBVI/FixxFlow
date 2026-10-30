'use client';

import { useActionState, useEffect } from 'react';

import { markNotificationsRead } from '@/app/app/notifications/actions';
import { Button } from '@/components/ui/button';

export function ReadButton({ id, all = false }: { id?: string; all?: boolean }) {
  const [state, action, pending] = useActionState(markNotificationsRead, {});
  useEffect(() => {
    if (state.success) window.dispatchEvent(new Event('notifications-changed'));
  }, [state]);
  return (
    <form action={action}>
      <input type="hidden" name={all ? 'all' : 'notificationId'} value={all ? 'true' : id} />
      <Button variant="quiet" disabled={pending} aria-busy={pending}>
        {pending ? 'Updating…' : all ? 'Mark all as read' : 'Mark as read'}
      </Button>
      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
