"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function NotificationLink({ organizationId, userId, className, onNavigate }: {
  organizationId: string; userId: string; className?: string; onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);
  const [supabase] = useState(createClient);
  useEffect(() => {
    let active = true;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId).eq("recipient_id", userId).is("read_at", null);
        if (active) setCount(error ? null : count);
      } catch { if (active) setCount(null); }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("notifications-changed", refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("notifications-changed", refresh); };
  }, [supabase, organizationId, userId, pathname]);
  const label = `Notifications${count ? `, ${count} unread` : ""}`;
  return <Link href="/app/notifications" className={className} aria-label={label} title={label}
    aria-current={pathname === "/app/notifications" ? "page" : undefined} onClick={onNavigate}>
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></svg>
    <span>Notifications{count ? <b className="notification-count">{count > 99 ? "99+" : count}</b> : null}</span>
  </Link>;
}
