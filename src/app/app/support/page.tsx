import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Contact support | FixxFlow' };

export default function SupportPage() {
  return (
    <div className="portal-page">
      <header className="portal-page-heading">
        <div>
          <Link className="button button-quiet page-back-link" href="/app">
            ← Home
          </Link>
          <h1>Contact support</h1>
          <p>
            For workplace IT issues, submit an IT request. For problems with FixxFlow itself, email
            product support.
          </p>
        </div>
      </header>
      <section className="portal-detail-card" aria-labelledby="email-support-heading">
        <h2 id="email-support-heading">Email FixxFlow support</h2>
        <p>Include your organization name and a short description of the problem.</p>
        <p>
          <a
            className="button button-primary"
            href="mailto:support@fixxflow.app?subject=FixxFlow%20support"
          >
            Email FixxFlow support
          </a>
        </p>
        <p className="muted">Opens your email app. Your message is sent when you choose Send.</p>
        <details className="progressive-section">
          <summary>Email app didn’t open?</summary>
          <p>
            Write to <a href="mailto:support@fixxflow.app">support@fixxflow.app</a> using your email
            service.
          </p>
        </details>
      </section>
      <section className="portal-detail-card" aria-labelledby="more-help-heading">
        <h2 id="more-help-heading">Workplace IT help</h2>
        <p>
          For equipment, access or other workplace IT issues, contact your IT team or find a guide.
        </p>
        <div className="page-header-actions">
          <Link className="button button-secondary" href="/app/tickets/new">
            Submit an IT request
          </Link>
          <Link className="button button-secondary" href="/app/help">
            Browse help articles
          </Link>
        </div>
      </section>
    </div>
  );
}
