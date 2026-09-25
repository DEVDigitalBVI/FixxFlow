import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { notificationHref, notificationLabels } from "@/features/notifications/presentation";
import { ReadButton } from "@/features/notifications/read-button";
import { ConversationRefresh } from "@/features/tickets/conversation-refresh";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const unread = params.view === "unread";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  const supabase = await createClient();
  let query = supabase.from("notifications").select("id,kind,title,ticket_id,conversation_id,created_at,read_at", { count: "exact" })
    .eq("organization_id", viewer.organizationId).eq("recipient_id", viewer.id);
  if (unread) query = query.is("read_at", null);
  const { data, count, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * 30, page * 30 - 1);
  const pageHref = (next: number) => `/app/notifications?${new URLSearchParams({ view: unread ? "unread" : "all", page: String(next) })}`;
  return <div className={`page notification-page${viewer.role === "end_user" ? " portal-detail" : ""}`}>
    <ConversationRefresh />
    <header className="page-header"><div><p className="page-eyebrow">YOUR UPDATES</p><h1>Notifications</h1><p className="page-description">Ticket and chat updates that need your attention.</p></div>{!error && <ReadButton all />}</header>
    <nav className="queue-views" aria-label="Notification filters"><Link href="/app/notifications" aria-current={!unread ? "page" : undefined}>All updates</Link><Link href="/app/notifications?view=unread" aria-current={unread ? "page" : undefined}>Unread</Link></nav>
    {error ? <div className="alert alert-error" role="alert">Notifications could not be loaded. <Link href={pageHref(page)}>Try again</Link></div>
      : !data?.length ? <section className="settings-card"><h2>{unread ? "You’re all caught up" : "No notifications yet"}</h2><p className="muted">{page > 1 ? "There are no updates on this page." : "Relevant ticket and chat updates will appear here."}</p>{page > 1 && <Link href={pageHref(1)}>Return to latest updates</Link>}</section>
      : <ul className="notification-list">{data.map(item => <li key={item.id} className={`notification-item${!item.read_at ? " notification-unread" : ""}`}>
        <div className="notification-copy"><div className="notification-meta"><span>{notificationLabels[item.kind]}</span><span>{item.read_at ? "Read" : "Unread"}</span><time dateTime={item.created_at}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tortola" }).format(new Date(item.created_at))} AST</time></div><Link className="notification-title" href={notificationHref(item)}>{item.title}</Link></div>
        {!item.read_at && <ReadButton id={item.id} />}
      </li>)}</ul>}
    {!error && <nav className="notification-pagination" aria-label="Notification pages">{page > 1 && <Link className="button button-secondary" href={pageHref(page - 1)}>Newer</Link>}<span>Page {page}</span>{page * 30 < (count ?? 0) && <Link className="button button-secondary" href={pageHref(page + 1)}>Older</Link>}</nav>}
  </div>;
}
