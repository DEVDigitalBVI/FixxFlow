import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { rolePresentation } from "@/features/identity/role";
import { Avatar } from "@/components/ui/avatar";
import { formatTicketDate, ticketPriorities, ticketStatuses } from "@/features/tickets/presentation";

export default async function OverviewPage() {
  const viewer = await requireViewer(); const supabase = await createClient();
  if (viewer.role === "end_user") {
    const { data: recent } = await supabase.from("tickets").select("id, ticket_number, title, status, updated_at").eq("organization_id", viewer.organizationId).eq("requester_id", viewer.id).order("updated_at", { ascending: false }).limit(3);
    const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone: "America/Tortola" }).format(new Date()));
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    return <div className="portal-page portal-home"><p className="portal-greeting">{greeting}, {viewer.displayName.split(" ")[0]}</p><h1>How can IT help?</h1><div className="portal-actions"><Link href="/app/chat" className="portal-action portal-action-primary"><strong>Start a chat</strong><span>Talk with IT about an issue</span><span aria-hidden="true">→</span></Link><Link href="/app/tickets/new" className="portal-action"><strong>Submit a request</strong><span>Tell us what you need</span><span aria-hidden="true">→</span></Link><Link href="/app/tickets" className="portal-action"><strong>My tickets</strong><span>Updates and previous requests</span><span aria-hidden="true">→</span></Link><Link href="/app/help" className="portal-action"><strong>Knowledge base</strong><span>Find a quick answer</span><span aria-hidden="true">→</span></Link></div><section className="portal-recent" aria-labelledby="recent-heading"><div className="portal-section-heading"><h2 id="recent-heading">Recent requests</h2><Link href="/app/tickets">View all</Link></div>{recent?.length ? <ul>{recent.map(ticket => <li key={ticket.id}><Link href={`/app/tickets/${ticket.id}`}><strong>{ticket.title}</strong><span>#{ticket.ticket_number} · {ticket.status.replaceAll("_", " ")}</span></Link></li>)}</ul> : <p>No requests yet. When you contact IT, you can follow progress here.</p>}</section></div>;
  }
  if (viewer.role === "technician") {
    const active = ["new", "open", "in_progress", "waiting_on_user", "on_hold"] as const;
    const base = () => supabase.from("tickets").select("id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId);
    const [mine, unassigned, waiting, overdue, critical, recent] = await Promise.all([
      base().eq("assigned_technician_id", viewer.id).in("status", [...active]),
      base().is("assigned_technician_id", null).in("status", [...active]),
      base().eq("status", "waiting_on_user"),
      base().lt("due_at", new Date().toISOString()).in("status", [...active]),
      base().eq("priority", "critical").in("status", [...active]),
      supabase.from("tickets").select("id, ticket_number, title, priority, status, updated_at").eq("organization_id", viewer.organizationId).order("updated_at", { ascending: false }).limit(8),
    ]);
    const metrics = [
      { label: "My tickets", count: mine.count, href: "/app/tickets?view=mine", hint: "Assigned to you" },
      { label: "Unassigned", count: unassigned.count, href: "/app/tickets?view=unassigned", hint: "Needs an owner" },
      { label: "Waiting on user", count: waiting.count, href: "/app/tickets?status=waiting_on_user", hint: "Awaiting a reply" },
      { label: "Overdue", count: overdue.count, href: "/app/tickets?overdue=1", hint: "Past due date" },
      { label: "Critical", count: critical.count, href: "/app/tickets?priority=critical", hint: "Active urgent work" },
    ];
    return <div className="page technician-home"><header className="page-header"><div><span className="page-eyebrow">IT support</span><h1>Good to see you, {viewer.displayName.split(" ")[0]}</h1><p>Here’s what needs attention across {viewer.organizationName}.</p></div><Link className="button button-primary" href="/app/tickets">Open ticket queue</Link></header><section className="tech-metrics" aria-label="Ticket overview">{metrics.map(metric => <Link key={metric.label} href={metric.href} className="tech-metric"><span>{metric.label}</span><strong>{metric.count ?? 0}</strong><small>{metric.hint}</small></Link>)}</section><section className="tech-recent" aria-labelledby="recent-tickets"><div className="tech-section-heading"><div><h2 id="recent-tickets">Recent tickets</h2><p>Latest activity across your service desk</p></div><Link href="/app/tickets">View all tickets</Link></div>{recent.data?.length ? <ul>{recent.data.map(ticket => <li key={ticket.id}><Link href={`/app/tickets/${ticket.id}`}><span className="tech-recent-id">#{ticket.ticket_number}</span><span className="tech-recent-title"><strong>{ticket.title}</strong><small>Updated {formatTicketDate(ticket.updated_at)}</small></span><span className={`ticket-badge tone-${ticketStatuses[ticket.status].tone}`}>{ticketStatuses[ticket.status].label}</span><span className={`ticket-badge tone-${ticketPriorities[ticket.priority].tone}`}>{ticketPriorities[ticket.priority].label}</span></Link></li>)}</ul> : <div className="empty-state"><strong>No tickets yet</strong><p>New requests will appear here.</p></div>}</section></div>;
  }
  const [people, departments, locations] = await Promise.all([
    supabase.from("organization_memberships").select("user_id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId).eq("status", "active"),
    supabase.from("departments").select("id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId).eq("is_active", true),
    supabase.from("locations").select("id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId).eq("is_active", true),
  ]);
  return <div className="page"><header className="page-header"><div><span className="page-eyebrow">Workspace overview</span><h1>{viewer.organizationName}</h1><p>People, access, and organization readiness at a glance.</p></div>{viewer.role === "administrator" && <Link className="button button-secondary" href="/app/people">Manage people <span aria-hidden="true">→</span></Link>}</header><section className="welcome-card"><div><span className="eyebrow">Welcome back</span><h2>{viewer.displayName}</h2><p>Your FixxFlow workspace is ready. Keep your organization details current as the team grows.</p></div><Avatar name={viewer.displayName} src={viewer.avatarUrl} size="large" /></section><section className="card-grid" aria-label="Organization metrics"><article className="metric-card"><div className="metric-icon metric-icon-blue" aria-hidden="true">01</div><div><h2>Active people</h2><p className="metric">{people.count ?? 0}</p><p className="muted">Members with workspace access</p></div></article><article className="metric-card"><div className="metric-icon metric-icon-cyan" aria-hidden="true">02</div><div><h2>Departments</h2><p className="metric">{departments.count ?? 0}</p><p className="muted">Active organizational groups</p></div></article><article className="metric-card"><div className="metric-icon metric-icon-purple" aria-hidden="true">03</div><div><h2>Locations</h2><p className="metric">{locations.count ?? 0}</p><p className="muted">Active service locations</p></div></article></section><section className="access-card"><div><span className="section-kicker">Your access</span><h2>{rolePresentation[viewer.role].label}</h2><p>{rolePresentation[viewer.role].description}</p></div><span className="badge badge-active">Active</span></section></div>;
}
