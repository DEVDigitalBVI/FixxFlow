import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { getReport } from "@/features/reporting/data";
import { TodayMetrics, ReportUnavailable } from "@/features/reporting/components";

export default async function OverviewPage() {
  const viewer = await requireViewer(); const supabase = await createClient();
  if (viewer.role === "end_user") {
    const { data: recent } = await supabase.from("tickets").select("id, ticket_number, title, status, updated_at").eq("organization_id", viewer.organizationId).eq("requester_id", viewer.id).order("updated_at", { ascending: false }).limit(3);
    const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone: "America/Tortola" }).format(new Date()));
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    return <div className="portal-page portal-home"><p className="portal-greeting">{greeting}, {viewer.displayName.split(" ")[0]}</p><h1>How can IT help?</h1><div className="portal-actions"><Link href="/app/chat?start=1" className="portal-action portal-action-primary"><strong>Start a chat</strong><span>Send IT a message and continue the conversation here</span><span aria-hidden="true">→</span></Link><Link href="/app/tickets/new" className="portal-action"><strong>Open a ticket</strong><span>Report a problem or request something you need</span><span aria-hidden="true">→</span></Link><Link href="/app/tickets" className="portal-action"><strong>My tickets</strong><span>Updates and previous requests</span><span aria-hidden="true">→</span></Link><Link href="/app/help" className="portal-action"><strong>Help articles</strong><span>Find a quick answer</span><span aria-hidden="true">→</span></Link></div><section className="portal-recent" aria-labelledby="recent-heading"><div className="portal-section-heading"><h2 id="recent-heading">Recent requests</h2><Link href="/app/tickets">View all</Link></div>{recent?.length ? <ul>{recent.map(ticket => <li key={ticket.id}><Link href={`/app/tickets/${ticket.id}`}><strong>{ticket.title}</strong><span>#{ticket.ticket_number} · {ticket.status.replaceAll("_", " ")}</span></Link></li>)}</ul> : <p>No requests yet. When you contact IT, you can follow progress here.</p>}</section></div>;
  }
  const report = await getReport(viewer.organizationId);
  return <div className="page overview-page"><header className="page-header"><div><span className="page-eyebrow">{viewer.organizationName}</span><h1>Support overview</h1><p>Today’s activity and the work that needs attention.</p></div><Link className="button button-primary" href="/app/tickets">Open ticket queue</Link></header>{report ? <TodayMetrics report={report}/> : <ReportUnavailable/>}<section className="overview-work" aria-labelledby="overview-work-heading"><div className="overview-section-heading"><div><h2 id="overview-work-heading">Your workspace</h2><p>Pick up the next conversation or move a request forward.</p></div><Link href="/app/reports">View reports &amp; trends <span aria-hidden="true">↗</span></Link></div><nav className="overview-queues" aria-label="Support shortcuts">{[
    { href: "/app/tickets?view=mine", title: "My assigned tickets", description: "Continue the work you own", symbol: "01" },
    { href: "/app/tickets?view=unassigned", title: "Unassigned tickets", description: "Find requests that need an owner", symbol: "02" },
    { href: "/app/tickets?sla=breached", title: "Overdue tickets", description: "Review requests past their SLA", symbol: "03" },
    { href: "/app/chat?view=unassigned", title: "Incoming chats", description: "Pick up a new conversation", symbol: "04" },
  ].map(item => <Link key={item.href} href={item.href} className="overview-queue"><span className="overview-queue-index" aria-hidden="true">{item.symbol}</span><span><strong>{item.title}</strong><span>{item.description}</span></span><span className="overview-queue-arrow" aria-hidden="true">→</span></Link>)}</nav></section><SupportActions/></div>;
}

function SupportActions() {
  return <section className="overview-help" aria-labelledby="overview-help-heading"><div className="overview-section-heading"><div><h2 id="overview-help-heading">Need help yourself?</h2><p>Reach your IT team or find a guide.</p></div><Link href="/app/help">Browse knowledge base <span aria-hidden="true">↗</span></Link></div><div className="portal-actions support-entry-actions"><Link href="/app/chat?start=1" className="portal-action"><strong>Start a chat</strong><span>Send the IT team a message about your issue</span><span aria-hidden="true">→</span></Link><Link href="/app/tickets/new" className="portal-action"><strong>Open a ticket</strong><span>Report a problem or request something you need</span><span aria-hidden="true">→</span></Link></div></section>;
}
