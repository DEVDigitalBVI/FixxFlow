import Link from "next/link";
import { ConversationRefresh } from "@/features/tickets/conversation-refresh";
import { SlaClock, SlaIndicator } from "@/features/tickets/sla-indicator";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { formatTicketDate, ticketPriorities, ticketStatuses } from "@/features/tickets/presentation";
import { BulkSelectAll } from "@/features/tickets/bulk-select-all";
import { normalizeQueueFilters } from "@/features/tickets/queue-filters";
import { bulkUpdateTickets } from "./actions";
import type { TicketPriority, TicketStatus } from "@/types/database";

type Filters = { page?: string; view?: string; team?: string; status?: string; priority?: string; q?: string; sort?: string; overdue?: string; sla?: string; success?: string; error?: string };
const active: TicketStatus[] = ["new", "open", "in_progress", "waiting_on_user", "on_hold"];
const sortOptions = { updated: "Recently updated", oldest: "Oldest update", newest: "Newest created", due: "Manual due date", sla: "SLA due soon", priority: "Highest priority" } as const;

export default async function TicketsPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const viewer = await requireViewer();
  const filters = await searchParams;
  const supabase = await createClient();
  const { view, sort, search } = normalizeQueueFilters(filters);
  const page = Math.max(1, Math.min(10000, Number.parseInt(filters.page ?? "1", 10) || 1));
  const pageHref = (next: number) => {
    const params = new URLSearchParams();
    for (const key of ["q", "view", "team", "status", "priority", "sort", "overdue", "sla"] as const) if (filters[key]) params.set(key, filters[key]);
    params.set("page", String(next));
    return `/app/tickets?${params}`;
  };
  const source = search ? supabase.rpc("search_tickets", { target_organization_id: viewer.organizationId, search_text: search }) : supabase.from("tickets");
  let query = source.select("id, ticket_number, title, requester_id, assigned_technician_id, team_id, priority, status, due_at, created_at, updated_at, first_response_at, resolved_at, closed_at, response_sla_due_at, resolution_sla_due_at, sla_next_due_at").eq("organization_id", viewer.organizationId);
  if (viewer.role === "end_user") query = query.eq("requester_id", viewer.id);
  else {
    if (view === "mine") query = query.eq("assigned_technician_id", viewer.id).in("status", active);
    if (view === "unassigned") query = query.is("assigned_technician_id", null).in("status", active);
    if (view === "team") query = query.not("team_id", "is", null).in("status", active);
    if (filters.team && /^[0-9a-f-]{36}$/i.test(filters.team)) query = query.eq("team_id", filters.team);
    if (filters.sla === "breached") query = query.lte("sla_next_due_at", new Date().toISOString());
    if (filters.overdue === "1") query = query.lt("due_at", new Date().toISOString()).in("status", active);
  }
  if (filters.status && filters.status in ticketStatuses) query = query.eq("status", filters.status as TicketStatus);
  if (filters.priority && filters.priority in ticketPriorities) query = query.eq("priority", filters.priority as TicketPriority);
  if (sort === "oldest") query = query.order("updated_at", { ascending: true });
  else if (sort === "newest") query = query.order("created_at", { ascending: false });
  else if (sort === "sla") query = query.order("sla_next_due_at", { ascending: true, nullsFirst: false });
  else if (sort === "due") query = query.order("due_at", { ascending: true, nullsFirst: false });
  else if (sort === "priority") query = query.order("priority", { ascending: false }).order("updated_at", { ascending: false });
  else query = query.order("updated_at", { ascending: false });
  const [{ data: rows, error }, { data: profiles }, { data: teams }, { data: members }] = await Promise.all([
    query.order("id").range((page - 1) * 50, page * 50),
    supabase.from("profiles").select("user_id, display_name").eq("organization_id", viewer.organizationId),
    supabase.from("teams").select("id, name").eq("organization_id", viewer.organizationId).eq("is_active", true),
    viewer.role === "end_user" ? Promise.resolve({ data: [] }) : supabase.from("organization_memberships").select("user_id").eq("organization_id", viewer.organizationId).eq("status", "active").in("role", ["technician", "administrator"]),
  ]);
  const tickets = rows?.slice(0, 50);
  const hasMore = (rows?.length ?? 0) > 50;
  const pagination = <nav className="notification-pagination" aria-label="Ticket pages">{page > 1 && <Link className="button button-secondary" href={pageHref(page - 1)}>Previous</Link>}<span>Page {page}</span>{hasMore && <Link className="button button-secondary" href={pageHref(page + 1)}>Next</Link>}</nav>;
  const { count: knowledgeCount } = search ? await supabase.rpc("search_knowledge_articles", { target_organization_id: viewer.organizationId, search_text: search }, { count: "exact", head: true }).select("id").eq("status", "published") : { count: null };
  const relatedArticles = search && <p className="queue-count"><Link href={`/app/help?q=${encodeURIComponent(search)}`}>Search knowledge articles{knowledgeCount ? ` (${knowledgeCount} ${knowledgeCount === 1 ? "match" : "matches"})` : ""}</Link></p>;
  const names = new Map((profiles ?? []).map(p => [p.user_id, p.display_name]));
  const teamNames = new Map((teams ?? []).map(t => [t.id, t.name]));
  if (viewer.role === "end_user") return <div className="portal-page"><header className="portal-page-heading"><div><Link href="/app">← Home</Link><h1>My tickets</h1><p>See updates and continue a conversation with IT.</p></div><Link className="button button-primary" href="/app/tickets/new">Submit a request</Link></header><form className="portal-search"><label htmlFor="ticket-search">Search requests</label><div><input id="ticket-search" className="input" name="q" defaultValue={filters.q} type="search" maxLength={200} placeholder="Words or #ticket number"/><button className="button button-secondary">Search</button></div></form>{relatedArticles}{error ? <div className="alert alert-error" role="alert">Requests could not be loaded. Refresh the page.</div> : tickets?.length ? <ul className="portal-ticket-list">{tickets.map(ticket => <li key={ticket.id}><Link href={`/app/tickets/${ticket.id}`}><span className="portal-ticket-main"><strong>{ticket.title}</strong><small>#{ticket.ticket_number} · Updated {formatTicketDate(ticket.updated_at)}</small></span><span className={`ticket-badge tone-${ticketStatuses[ticket.status].tone}`}>{ticketStatuses[ticket.status].label}</span><span aria-hidden="true">→</span></Link></li>)}</ul> : <div className="portal-empty"><h2>No requests found</h2><p>{filters.q ? "Try a different search." : "When you contact IT, your requests will appear here."}</p><Link href="/app/tickets/new" className="button button-primary">Submit a request</Link></div>}{!error && pagination}</div>;
  const views = [{ value: "mine", label: "My tickets" }, { value: "unassigned", label: "Unassigned" }, { value: "team", label: "Team queue" }, { value: "all", label: "All tickets" }];
  const workers = (members ?? []).map(m => ({ id: m.user_id, name: names.get(m.user_id) ?? "Team member" })).sort((a, b) => a.name.localeCompare(b.name));
  return <div className="page"><ConversationRefresh/><header className="page-header"><div><span className="page-eyebrow">IT support</span><h1>Ticket queue</h1><p>Find, assign, and move support work forward. SLA targets use calendar hours.</p></div><Link className="button button-primary" href="/app/tickets/new">New ticket</Link></header>
    <nav className="queue-views" aria-label="Ticket views">{views.map(item => <Link key={item.value} href={`/app/tickets?view=${item.value}`} aria-current={view === item.value ? "page" : undefined}>{item.label}</Link>)}</nav>
    <form className="queue-filters"><input type="hidden" name="view" value={view}/><label>Search<input className="input" name="q" defaultValue={filters.q} type="search" maxLength={200} aria-describedby="ticket-search-hint" placeholder="VPN error 809 or #1052"/></label><label>Status<select className="input" name="status" defaultValue={filters.status ?? ""}><option value="">Any status</option>{Object.entries(ticketStatuses).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}</select></label><label>Priority<select className="input" name="priority" defaultValue={filters.priority ?? ""}><option value="">Any priority</option>{Object.entries(ticketPriorities).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}</select></label><label>Team<select className="input" name="team" defaultValue={filters.team ?? ""}><option value="">All teams</option>{teams?.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Sort by<select className="input" name="sort" defaultValue={sort}>{Object.entries(sortOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="queue-check"><input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue === "1"}/> Manual date overdue</label><label className="queue-check"><input type="checkbox" name="sla" value="breached" defaultChecked={filters.sla === "breached"}/> SLA breached</label><button className="button button-secondary" type="submit">Apply filters</button><Link href={`/app/tickets?view=${view}`} className="queue-clear">Clear filters</Link></form>
    <p id="ticket-search-hint" className="queue-count">Search ticket titles, descriptions, messages, people, and categories. Use # for an exact ticket number. Filters also apply to search results.</p>{relatedArticles}
    {filters.error && <div className="alert alert-error page-alert" role="alert">{filters.error}</div>}{filters.success && <div className="alert alert-success page-alert" role="status">{filters.success}</div>}
    {error ? <div className="alert alert-error" role="alert">Tickets could not be loaded. Refresh the queue to try again.</div> : <SlaClock initialNow={new Date().getTime()}><form id="bulk-ticket-form" action={bulkUpdateTickets}><div className="bulk-toolbar"><strong>Bulk actions</strong><label>Status<select className="input" name="status" defaultValue=""><option value="">Choose status</option>{Object.entries(ticketStatuses).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}</select></label><button className="button button-secondary button-small" type="submit" name="intent" value="status">Change status</button><label>Priority<select className="input" name="priority" defaultValue=""><option value="">Choose priority</option>{Object.entries(ticketPriorities).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}</select></label><button className="button button-secondary button-small" type="submit" name="intent" value="priority">Change priority</button><label>Assign to<select className="input" name="assignee" defaultValue=""><option value="">Unassigned</option>{workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label><button className="button button-secondary button-small" type="submit" name="intent" value="assignee">Assign</button></div><div className="table-region" role="region" aria-label="Tickets" tabIndex={0}>{tickets?.length ? <table className="table ticket-table responsive-table"><thead><tr><th scope="col"><BulkSelectAll formId="bulk-ticket-form"/></th><th scope="col">Ticket</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Requester</th><th scope="col">Assigned to</th><th scope="col">SLA</th><th scope="col">Updated</th></tr></thead><tbody>{tickets.map(ticket => <tr key={ticket.id}><td data-label="Select"><input className="queue-row-check" type="checkbox" name="ticketIds" value={ticket.id} aria-label={`Select ticket ${ticket.ticket_number}`}/></td><td data-label="Ticket"><Link className="ticket-link" href={`/app/tickets/${ticket.id}`}><strong>#{ticket.ticket_number} · {ticket.title}</strong><span>{ticket.team_id ? teamNames.get(ticket.team_id) ?? "Team" : "No team"}{ticket.due_at && new Date(ticket.due_at) < new Date() && active.includes(ticket.status) ? " · Overdue" : ""}</span></Link></td><td data-label="Status"><span className={`ticket-badge tone-${ticketStatuses[ticket.status].tone}`}>{ticketStatuses[ticket.status].label}</span></td><td data-label="Priority"><span className={`ticket-badge tone-${ticketPriorities[ticket.priority].tone}`}>{ticketPriorities[ticket.priority].label}</span></td><td data-label="Requester">{names.get(ticket.requester_id) ?? "Unknown"}</td><td data-label="Assigned to">{ticket.assigned_technician_id ? names.get(ticket.assigned_technician_id) ?? "Unknown" : <span className="muted">Unassigned</span>}</td><td data-label="SLA"><SlaIndicator ticket={ticket} compact/></td><td data-label="Updated" className="muted">{formatTicketDate(ticket.updated_at)}</td></tr>)}</tbody></table> : <div className="empty-state"><strong>No tickets found</strong><p>Try another view or clear the filters.</p><Link href="/app/tickets" className="button button-secondary">Show all tickets</Link></div>}</div><p className="queue-count">Showing {tickets?.length ?? 0} tickets on this page.</p>{pagination}</form></SlaClock>}
  </div>;
}
