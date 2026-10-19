import Link from "next/link";
import { SEARCH_HINT, SEARCH_LIMIT } from "@/lib/search";
import { formatTicketDate, ticketStatuses } from "@/features/tickets/presentation";
import type { TicketStatus } from "@/types/database";

type RecentRequest = {
  id: string;
  ticket_number: number;
  title: string;
  status: TicketStatus;
  updated_at?: string;
};

type EmployeeHomeProps = {
  firstName: string;
  greeting: string;
  organizationName: string;
  recent: RecentRequest[];
  timeZone?: string;
};

const actions = [
  {
    href: "/app/chat?start=1",
    title: "Chat with IT",
    description: "Best for a quick question or help you need right now",
  },
  {
    href: "/app/tickets/new",
    title: "Submit a request",
    description: "Track an issue, access request, or equipment need",
  },
] as const;

export function EmployeeHome({ firstName, greeting, organizationName, recent, timeZone = "UTC" }: EmployeeHomeProps) {
  return <div className="portal-page portal-home">
    <section className="portal-home-intro" aria-labelledby="portal-home-heading">
      <span className="portal-kicker">{organizationName} IT support</span>
      <p className="portal-greeting">{greeting}, {firstName}</p>
      <h1 id="portal-home-heading">How can IT help today?</h1>
      <p className="portal-home-summary">Get help from your IT team or pick up an existing request.</p>
    </section>
    <div className="portal-actions">
      {actions.map(action => <Link
        className="portal-action"
        href={action.href}
        key={action.href}
      >
        <strong>{action.title}</strong>
        <span>{action.description}</span>
        <span aria-hidden="true">→</span>
      </Link>)}
    </div>
    <section className="portal-home-search" aria-labelledby="home-search-heading">
      <div className="portal-section-heading"><h2 id="home-search-heading">Find an answer</h2><Link href="/app/help">Browse help articles</Link></div>
      <form action="/app/help" method="get" role="search" aria-label="Help articles">
        <label htmlFor="home-help-query">Search help articles</label>
        <div className="portal-home-search-controls"><input className="input" id="home-help-query" name="q" type="search" maxLength={SEARCH_LIMIT} aria-describedby="home-help-hint" placeholder="Try Wi-Fi, password, or email"/><button className="button button-primary" type="submit">Search</button></div>
        <p id="home-help-hint">{SEARCH_HINT}</p>
      </form>
    </section>
    <section className="portal-recent" aria-labelledby="recent-heading">
      <div className="portal-section-heading">
        <div><h2 id="recent-heading">Recent requests</h2><p>Continue where you left off.</p></div>
        <Link className="button button-secondary" href="/app/tickets">View all requests</Link>
      </div>
      {recent.length ? <ul>{recent.map(ticket => <li key={ticket.id}><Link href={`/app/tickets/${ticket.id}`}>
        <div className="portal-request-copy"><strong>{ticket.title}</strong><div className="portal-request-meta"><span>#{ticket.ticket_number}</span>{ticket.updated_at && <span>Updated <time dateTime={ticket.updated_at}>{formatTicketDate(ticket.updated_at, timeZone)}</time></span>}</div></div>
        <span className={`ticket-badge tone-${ticketStatuses[ticket.status].tone}`}>{ticketStatuses[ticket.status].label}</span>
      </Link></li>)}</ul> : <div className="portal-recent-empty"><strong>No requests yet</strong><p>When you contact IT, updates and replies will appear here.</p></div>}
    </section>
  </div>;
}
