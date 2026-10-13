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
    title: "Start a conversation",
    description: "Message IT and keep the conversation in one place",
    primary: true,
  },
  {
    href: "/app/tickets/new",
    title: "Report an issue",
    description: "Describe a problem or request something you need",
  },
  {
    href: "/app/tickets",
    title: "Track my requests",
    description: "See replies, progress, and next steps",
    quiet: true,
  },
  {
    href: "/app/help",
    title: "Find an answer",
    description: "Browse practical help articles",
    quiet: true,
  },
] as const;

export function EmployeeHome({ firstName, greeting, organizationName, recent }: EmployeeHomeProps) {
  return <div className="portal-page portal-home">
    <section className="portal-home-intro" aria-labelledby="portal-home-heading">
      <span className="portal-kicker">{organizationName} IT support</span>
      <p className="portal-greeting">{greeting}, {firstName}</p>
      <h1 id="portal-home-heading">How can IT help today?</h1>
      <p className="portal-home-summary">Start a conversation, report a problem, or find an answer. Your updates stay together here.</p>
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
