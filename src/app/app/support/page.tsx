import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact support | FixxFlow" };

export default function SupportPage() {
  return <div className="portal-page">
    <header className="portal-page-heading">
      <div><Link className="button button-quiet page-back-link" href="/app">← Home</Link><h1>Contact support</h1><p>Get help with your FixxFlow account or the app.</p></div>
    </header>
    <section className="portal-detail-card" aria-labelledby="email-support-heading">
      <h2 id="email-support-heading">Email FixxFlow support</h2>
      <p>Tell us what you need help with, what happened, and what you expected. Include your organization name and any relevant screenshots.</p>
      <p><a className="button button-primary" href="mailto:support@fixxflow.app?subject=FixxFlow%20support">Email support</a></p>
      <p className="muted">Opens your email app. If it doesn’t open, compose a message in your email service to <a href="mailto:support@fixxflow.app">support@fixxflow.app</a>.</p>
      <p className="muted">Your message is sent when you choose Send in your email app.</p>
    </section>
    <section className="portal-detail-card" aria-labelledby="more-help-heading">
      <h2 id="more-help-heading">More ways to get help</h2>
      <p>For equipment, access or other workplace IT issues, contact your IT team or find a guide.</p>
      <div className="page-header-actions"><Link className="button button-secondary" href="/app/tickets/new">Submit an IT request</Link><Link className="button button-secondary" href="/app/help">Browse help articles</Link></div>
    </section>
  </div>;
}
