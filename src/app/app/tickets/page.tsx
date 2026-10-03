import { PageHeader } from '@/components/ui/page-header';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { loadTicketQueue, type TicketQueueFilters } from "@/features/tickets/data";
import { SEARCH_HINT, SEARCH_LIMIT } from '@/lib/search';
import { UsageEvent } from "@/features/product-analytics/usage-event";
import { BulkActions } from "@/features/tickets/bulk-actions";
import Link from "next/link";
import { ConversationRefresh } from "@/features/tickets/conversation-refresh";
import { SlaClock, SlaIndicator } from "@/features/tickets/sla-indicator";
import { requireViewer } from "@/lib/auth/viewer";
import { formatTicketDate, ticketPriorities, ticketStatuses } from "@/features/tickets/presentation";
import { BulkSelectAll } from "@/features/tickets/bulk-select-all";
import { bulkUpdateTickets } from "./actions";
import type { TicketStatus } from "@/types/database";

const active: TicketStatus[] = ["new", "open", "in_progress", "waiting_on_user", "on_hold"];
const sortOptions = { updated: "Recently updated", oldest: "Oldest update", newest: "Newest created", due: "Manual due date", sla: "SLA due soon", priority: "Highest priority" } as const;

export default async function TicketsPage({ searchParams }: { searchParams: Promise<TicketQueueFilters> }) {
  const viewer = await requireViewer();
  const filters = await searchParams;
  const { view, sort, search, page, rows, error, profiles, teams, members, knowledgeCount } = await loadTicketQueue(viewer, filters);
  const pageHref = (next: number) => {
    const params = new URLSearchParams();
    for (const key of ["q", "view", "team", "status", "priority", "sort", "overdue", "sla"] as const) if (filters[key]) params.set(key, filters[key]);
    params.set("page", String(next));
    return `/app/tickets?${params}`;
  };
  const tickets = rows?.slice(0, 50);
  const searchSummary = error ? "Tickets could not load. Use Search to try again." : `${tickets?.length ?? 0} tickets on this page${(rows?.length ?? 0) > 50 ? ", with more results available" : ""}.`;
  const hasMore = (rows?.length ?? 0) > 50;
  const pagination = <nav className="notification-pagination" aria-label="Ticket pages">{page > 1 && <Link className="button button-secondary" href={pageHref(page - 1)}>Previous</Link>}<span>Page {page}</span>{hasMore && <Link className="button button-secondary" href={pageHref(page + 1)}>Next</Link>}</nav>;
  const usage = viewer.usageSharing && search && !error && page === 1 ? <UsageEvent key={search} event="search_performed" surface="tickets"/> : null;
  const relatedArticles = search && <p className="queue-count"><Link href={`/app/help?q=${encodeURIComponent(search)}`}>Search knowledge articles{knowledgeCount ? ` (${knowledgeCount} ${knowledgeCount === 1 ? "match" : "matches"})` : ""}</Link></p>;
  const names = new Map((profiles ?? []).map(p => [p.user_id, p.display_name]));
  const teamNames = new Map((teams ?? []).map(t => [t.id, t.name]));
  if (viewer.role === "end_user") return <div className="portal-page">{usage}<header className="portal-page-heading"><div><Link className="button button-quiet page-back-link" href="/app">← Home</Link><h1>My tickets</h1><p>See updates and continue a conversation with IT.</p></div><Link className="button button-primary" href="/app/tickets/new">Submit a request</Link></header><LiveSearchForm action="/app/tickets" className="portal-search" label="Search requests" resultSummary={searchSummary}><label htmlFor="ticket-search">Search requests</label><div><input id="ticket-search" className="input" name="q" defaultValue={search} type="search" maxLength={SEARCH_LIMIT} aria-describedby="ticket-search-hint" placeholder="Words or #ticket number"/><button className="button button-secondary">Search</button></div>{search&&<Link className="button button-quiet queue-clear" href="/app/tickets">Clear search</Link>}</LiveSearchForm><p id="ticket-search-hint" className="muted">{SEARCH_HINT} Use # for an exact ticket number.</p>{relatedArticles}{error ? <div className="alert alert-error" role="alert">Requests could not be loaded. Refresh the page.</div> : tickets?.length ? <ul className="portal-ticket-list">{tickets.map(ticket => <li key={ticket.id}><Link href={`/app/tickets/${ticket.id}`}><span className="portal-ticket-main"><strong>{ticket.title}</strong><small>#{ticket.ticket_number} · Updated {formatTicketDate(ticket.updated_at)}</small></span><span className={`ticket-badge tone-${ticketStatuses[ticket.status].tone}`}>{ticketStatuses[ticket.status].label}</span><span aria-hidden="true">→</span></Link></li>)}</ul> : <div className="portal-empty"><h2>No requests found</h2><p>{filters.q ? "Try a different search." : "When you contact IT, your requests will appear here."}</p><Link href="/app/tickets/new" className="button button-primary">Submit a request</Link></div>}{!error && pagination}</div>;
  const views = [
    { value: "mine", label: "My tickets", description: "Active support work assigned to you." },
    { value: "unassigned", label: "Unassigned", description: "Active tickets ready for someone to pick up." },
    { value: "team", label: "Team queue", description: "Active support work routed to your workspace’s teams." },
    { value: "all", label: "All tickets", description: "Support work across your workspace." },
  ];
  const currentView = views.find(item => item.value === view)!;
  const clearHref = `/app/tickets?view=${view}`;
  const withoutFilter = (key: keyof TicketQueueFilters) => {
    const params = new URLSearchParams();
    for (const name of ["q", "view", "team", "status", "priority", "sort", "overdue", "sla"] as const) {
      if (name !== key && filters[name]) params.set(name, filters[name]);
    }
    return `/app/tickets?${params}`;
  };
  const filterChips = [
    { key: "q", label: search ? `Search: ${search}` : null },
    { key: "status", label: Object.entries(ticketStatuses).find(([key]) => key === filters.status)?.[1].label },
    { key: "priority", label: Object.entries(ticketPriorities).find(([key]) => key === filters.priority)?.[1].label },
    { key: "team", label: filters.team ? teamNames.get(filters.team) ?? "Selected team" : null },
    { key: "overdue", label: filters.overdue === "1" ? "Manual date overdue" : null },
    { key: "sla", label: filters.sla === "breached" ? "SLA breached" : null },
  ] as const;
  const appliedFilters = filterChips.filter(item => item.label);
  const activeFilterCount = appliedFilters.filter(item => item.key !== "q").length;
  const workers = (members ?? []).map(m => ({ id: m.user_id, name: names.get(m.user_id) ?? "Team member" })).sort((a, b) => a.name.localeCompare(b.name));
  return <div className="page ticket-queue-page">
    {usage}<ConversationRefresh/>
    <PageHeader title="Ticket queue" eyebrow={viewer.organizationName} description="Find, assign and move support work forward." actions={<Link className="button button-primary" href="/app/tickets/new">New ticket</Link>}/>
    {filters.error && <div className="alert alert-error page-alert" role="alert">{filters.error}</div>}
    {filters.success && <div className="alert alert-success page-alert" role="status">{filters.success}</div>}
    <section className="ticket-queue-panel" aria-labelledby="ticket-queue-heading">
      <header className="ticket-queue-heading">
        <div><h2 id="ticket-queue-heading">{currentView.label}</h2><p>{currentView.description}</p></div>
        <span className="ticket-queue-page-count">{error ? "Queue unavailable" : `${tickets?.length ?? 0} on this page`}</span>
      </header>
      <nav className="queue-views" aria-label="Ticket views">{views.map(item => <Link key={item.value} href={`/app/tickets?view=${item.value}`} aria-current={view === item.value ? "page" : undefined}>{item.label}</Link>)}</nav>
      <div className="ticket-queue-toolbar">
        <LiveSearchForm action="/app/tickets" className="queue-filters" label="Search tickets" resultSummary={searchSummary}>
          <input type="hidden" name="view" value={view}/>
          <label className="ticket-queue-search">Search tickets<input className="input" name="q" defaultValue={search} type="search" maxLength={SEARCH_LIMIT} aria-describedby="ticket-search-hint" placeholder="Search by subject, person or #ticket number…"/></label>
          <button className="button button-secondary" type="submit">Search tickets</button>
          {(appliedFilters.length > 0 || sort !== "updated") && <Link href={clearHref} className="button button-quiet queue-clear">Clear filters</Link>}
          <details className="queue-filter-options" open={activeFilterCount > 0 || sort !== "updated"}>
            <summary>Filters and sort{activeFilterCount > 0 ? ` · ${activeFilterCount} active` : ""}</summary>
            <div className="queue-filter-fields">
              <label>Status<select className="input" name="status" defaultValue={filters.status ?? ""}><option value="">Any status</option>{Object.entries(ticketStatuses).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}</select></label>
              <label>Priority<select className="input" name="priority" defaultValue={filters.priority ?? ""}><option value="">Any priority</option>{Object.entries(ticketPriorities).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}</select></label>
              <label>Team<select className="input" name="team" defaultValue={filters.team ?? ""}><option value="">All teams</option>{teams?.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
              <label>Sort by<select className="input" name="sort" defaultValue={sort}>{Object.entries(sortOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="queue-check"><input type="checkbox" name="overdue" value="1" defaultChecked={filters.overdue === "1"}/> Manual date overdue</label>
              <label className="queue-check"><input type="checkbox" name="sla" value="breached" defaultChecked={filters.sla === "breached"}/> SLA breached</label>
            </div>
            <button className="button button-secondary ticket-queue-apply" type="submit">Apply filters</button>
          </details>
        </LiveSearchForm>
        <p id="ticket-search-hint" className="sr-only">{SEARCH_HINT} Search ticket titles, descriptions, messages, people, and categories. Use # for an exact ticket number. Filters also apply to search results.</p>
        {!!appliedFilters.length && <ul className="ticket-queue-filter-chips" aria-label="Applied ticket filters">{appliedFilters.map(item => <li key={item.key}><Link href={withoutFilter(item.key)} aria-label={`Remove ${item.key === "q" ? "search" : item.key} filter: ${item.label}`}><span>{item.label}</span><span aria-hidden="true">×</span></Link></li>)}</ul>}
        {relatedArticles}
      </div>
      {error ? <div className="ticket-queue-feedback"><div className="alert alert-error" role="alert">Tickets could not be loaded.<Link className="button button-secondary" href={pageHref(page)}>Try again</Link></div></div> : <SlaClock initialNow={new Date().getTime()}>
        <form id="bulk-ticket-form" action={bulkUpdateTickets}>
          {!!tickets?.length && <div className="ticket-queue-list-heading"><div className="queue-selection-control"><label><BulkSelectAll formId="bulk-ticket-form"/> Select page</label></div><span>{sortOptions[sort]}<span className="ticket-queue-sla-note"> · SLA targets use calendar hours</span></span></div>}
          <BulkActions formId="bulk-ticket-form"><div className="bulk-toolbar">
            <strong>Bulk actions</strong>
            <label>Status<select className="input" name="status" defaultValue=""><option value="">Choose status</option>{Object.entries(ticketStatuses).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}</select></label><button className="button button-secondary button-small" type="submit" name="intent" value="status">Change status</button>
            <label>Priority<select className="input" name="priority" defaultValue=""><option value="">Choose priority</option>{Object.entries(ticketPriorities).map(([value, p]) => <option key={value} value={value}>{p.label}</option>)}</select></label><button className="button button-secondary button-small" type="submit" name="intent" value="priority">Change priority</button>
            <label>Assign to<select className="input" name="assignee" defaultValue=""><option value="">Unassigned</option>{workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}</select></label><button className="button button-secondary button-small" type="submit" name="intent" value="assignee">Assign</button>
          </div></BulkActions>
          {tickets?.length ? <div className="table-region" role="region" aria-label="Tickets" tabIndex={0}><table className="table ticket-table responsive-table">
            <thead><tr><th scope="col"><span className="sr-only">Select</span></th><th scope="col">Ticket</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Requester</th><th scope="col">Assigned to</th><th scope="col">SLA</th><th scope="col">Updated</th></tr></thead>
            <tbody>{tickets.map(ticket => <tr key={ticket.id}>
              <td data-label="Select"><input className="queue-row-check" type="checkbox" name="ticketIds" value={ticket.id} aria-label={`Select ticket ${ticket.ticket_number}`}/></td>
              <td data-label="Ticket"><Link className="ticket-link" href={`/app/tickets/${ticket.id}`}><strong>{ticket.title}</strong><span>#{ticket.ticket_number} · {ticket.team_id ? teamNames.get(ticket.team_id) ?? "Team" : "No team"}{ticket.due_at && new Date(ticket.due_at) < new Date() && active.includes(ticket.status) ? " · Overdue" : ""}</span></Link></td>
              <td data-label="Status"><span className={`ticket-badge tone-${ticketStatuses[ticket.status].tone}`}>{ticketStatuses[ticket.status].label}</span></td>
              <td data-label="Priority"><span className={`ticket-badge tone-${ticketPriorities[ticket.priority].tone}`}>{ticketPriorities[ticket.priority].label}</span></td>
              <td data-label="Requester">{names.get(ticket.requester_id) ?? "Unknown"}</td>
              <td data-label="Assigned to">{ticket.assigned_technician_id ? names.get(ticket.assigned_technician_id) ?? "Unknown" : <span className="muted">Unassigned</span>}</td>
              <td data-label="SLA"><SlaIndicator ticket={ticket} compact/></td>
              <td data-label="Updated" className="muted"><time dateTime={ticket.updated_at}>{formatTicketDate(ticket.updated_at)}</time></td>
            </tr>)}</tbody>
          </table></div> : <div className="empty-state ticket-queue-empty"><span className="empty-icon" aria-hidden="true">✓</span><h3>{appliedFilters.length ? "No matching tickets" : page > 1 ? "No tickets on this page" : "Nothing in this queue yet"}</h3><p>{appliedFilters.length ? "Try a shorter search or remove a filter to broaden your results." : page > 1 ? "Return to the first page to see the latest support work." : "New support work will appear here. Check all tickets or create a ticket to get started."}</p><Link href={appliedFilters.length ? clearHref : page > 1 ? pageHref(1) : "/app/tickets?view=all"} className="button button-secondary">{appliedFilters.length ? "Clear filters" : page > 1 ? "Back to first page" : "Show all tickets"}</Link></div>}
          <footer className="ticket-queue-footer"><span className="muted">{tickets?.length ? `Showing ${(page - 1) * 50 + 1}–${(page - 1) * 50 + tickets.length}${hasMore ? " · More tickets available" : ""}` : "No results"}</span>{pagination}</footer>
        </form>
      </SlaClock>}
    </section>
  </div>;
}
