import { PageHeader } from "@/components/ui/page-header";
import { StartChatForm, ChatIntakeGuide } from "@/features/chat/start-chat-form";
import { ChatQueue } from "@/features/chat/chat-queue";
import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { LiveChatQueue } from "@/features/chat/live-queue";
import { formatTicketDate } from "@/features/tickets/presentation";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ error?: string; view?: string; start?: string }> }) {
  const viewer = await requireViewer();
  const { error: message, view, start } = await searchParams;
  if (start === "1" || message) return <div className={viewer.role === "end_user" ? "portal-page chat-intake-page" : "page chat-intake-page"}>
    <PageHeader title="Start a chat" eyebrow="Your IT support" description="Tell us what’s happening. We’ll take it from here." back={{ href: "/app/chat", label: "Back to chats" }}/>
    <div className="chat-intake-layout"><StartChatForm initialError={message}/><ChatIntakeGuide/></div>
  </div>;
  const supabase = await createClient();
  let query = supabase.from("chat_conversations").select("id, topic, requester_id, assigned_technician_id, status, ticket_id, updated_at").eq("organization_id", viewer.organizationId).order("updated_at", { ascending: false }).limit(100);
  if (viewer.role === "end_user") query = query.eq("requester_id", viewer.id);
  else if (view === "unassigned") query = query.is("assigned_technician_id", null).eq("status", "open");
  else if (view === "mine") query = query.eq("assigned_technician_id", viewer.id).eq("status", "open");
  else if (view !== "all") query = query.eq("status", "open");
  const [{ data: chats, error }, { data: profiles }] = await Promise.all([query, viewer.role === "end_user" ? Promise.resolve({ data: [] }) : supabase.from("profiles").select("user_id, display_name").eq("organization_id", viewer.organizationId)]);
  const names = new Map((profiles ?? []).map(p => [p.user_id, p.display_name]));
  if (viewer.role === "end_user") return <div className="portal-page portal-form-page"><header className="portal-page-heading"><div><Link className="button button-quiet page-back-link" href="/app">← Home</Link><h1>My chats</h1><p>Read replies or start a new conversation with IT.</p></div><Link className="button button-primary" href="/app/chat?start=1">Start a chat</Link></header><section className="chat-history-list"><h2>Your conversations</h2>{error ? <p role="alert">Conversations could not be loaded. Refresh to try again.</p> : chats?.length ? <ul>{chats.map(chat => <li key={chat.id}><Link href={`/app/chat/${chat.id}`}><strong>{chat.topic}</strong><span>{chat.status === "open" ? "Open" : "Closed"} · {formatTicketDate(chat.updated_at)}</span></Link></li>)}</ul> : <p>No chats yet. Choose “Start a chat” to send your first message to IT.</p>}</section></div>;
  const activeView = ["mine", "unassigned", "all"].includes(view ?? "") ? view : "open";
  return <div className="page chat-page">
    <PageHeader title="Chats" eyebrow={viewer.organizationName} description="Keep conversations moving, from the first question to the next step." actions={<Link className="button button-primary" href="/app/chat?start=1">Start a chat</Link>}/>
    <section className="chat-inbox" aria-labelledby="chat-inbox-title">
      <div className="chat-inbox-toolbar">
        <nav className="queue-views" aria-label="Chat views">{[
          { value: "open", label: "Open", href: "/app/chat" },
          { value: "unassigned", label: "Unassigned", href: "/app/chat?view=unassigned" },
          { value: "mine", label: "My chats", href: "/app/chat?view=mine" },
          { value: "all", label: "History", href: "/app/chat?view=all" },
        ].map(item => <Link key={item.value} href={item.href} aria-current={activeView === item.value ? "page" : undefined}>{item.label}</Link>)}</nav>
        <LiveChatQueue organizationId={viewer.organizationId}/>
      </div>
      <ChatQueue chats={chats ?? []} names={names} view={activeView ?? "open"} failed={Boolean(error)}/>
    </section>
  </div>;
}
