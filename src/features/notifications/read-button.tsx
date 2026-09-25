"use client";

import { useActionState, useEffect } from "react";
import { markNotificationsRead } from "@/app/app/notifications/actions";

export function ReadButton({ id, all = false }: { id?: string; all?: boolean }) {
  const [state, action, pending] = useActionState(markNotificationsRead, {});
  useEffect(() => { if (state.success) window.dispatchEvent(new Event("notifications-changed")); }, [state]);
  return <form action={action}>
    <input type="hidden" name={all ? "all" : "notificationId"} value={all ? "true" : id} />
    <button className="button button-secondary" disabled={pending}>{pending ? "Updating…" : all ? "Mark all as read" : "Mark as read"}</button>
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
  </form>;
}
