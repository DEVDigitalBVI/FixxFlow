"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LiveChatQueue({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`chat-queue:${organizationId}`, { config: { private: true } })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations", filter: `organization_id=eq.${organizationId}` }, () => router.refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `organization_id=eq.${organizationId}` }, () => router.refresh());
    void supabase.realtime.setAuth().then(() => channel.subscribe(status => setConnected(status === "SUBSCRIBED")));
    const fallback = window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20000);
    return () => { window.clearInterval(fallback); void supabase.removeChannel(channel); };
  }, [organizationId, router]);
  return <span className="chat-connection" role="status">{connected ? "Live queue" : "Refreshing queue"}</span>;
}
