import Link from "next/link";

type RecentRequest = {
  id: string;
  ticket_number: number;
  title: string;
  status: string;
};

type EmployeeHomeProps = {
  firstName: string;
  greeting: string;
  organizationName: string;
  recent: RecentRequest[];
};

const actions = [
  {
    href: "/app/chat?start=1",
    title: "Chat with IT",
    description: "Best for a quick question or help you need right now",
    primary: true,
  },
  {
    href: "/app/tickets/new",
    title: "Submit a request",
    description: "Track an issue, access request, or equipment need",
  },
  {
    href: "/app/help",
    title: "Search help articles",
    description: "Find a step-by-step answer before contacting IT",
    quiet: true,
  },
] as const;

export function EmployeeHome({ firstName, greeting, organizationName, recent }: EmployeeHomeProps) {
  return <div className="portal-page portal-home">
    <section className="portal-home-intro" aria-labelledby="portal-home-heading">
      <span className="portal-kicker">{organizationName} IT support</span>
      <p className="portal-greeting">{greeting}, {firstName}</p>
      <h1 id="portal-home-heading">How can IT help today?</h1>
      <p className="portal-home-summary">Choose the kind of help you need. You can return here anytime to follow your requests.</p>
    </section>
    <div className="portal-actions">
      {actions.map(action => <Link
        className={`portal-action${"primary" in action && action.primary ? " portal-action-primary" : ""}${"quiet" in action && action.quiet ? " portal-action-quiet" : ""}`}
        href={action.href}
        key={action.href}
      >
        <strong>{action.title}</strong>
        <span>{action.description}</span>
        <span aria-hidden="true">→</span>
      </Link>)}
    </div>
    <section className="portal-recent" aria-labelledby="recent-heading">
      <div className="portal-section-heading">
        <div><h2 id="recent-heading">Recent requests</h2><p>Continue where you left off.</p></div>
        <Link className="button button-secondary" href="/app/tickets">View all requests</Link>
      </div>
      {recent.length ? <ul>{recent.map(ticket => <li key={ticket.id}><Link href={`/app/tickets/${ticket.id}`}>
        <strong>{ticket.title}</strong>
        <span>#{ticket.ticket_number} · {ticket.status.replaceAll("_", " ")}</span>
      </Link></li>)}</ul> : <div className="portal-recent-empty"><strong>No requests yet</strong><p>When you contact IT, updates and replies will appear here.</p></div>}
    </section>
  </div>;
}
