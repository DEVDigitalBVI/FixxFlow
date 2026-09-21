import Link from "next/link";

const articles = [
  { title: "Reset your password", body: "Use the Forgot password link on the sign-in page. Open the email we send you and choose a new password. If you cannot access your email, contact IT." },
  { title: "Connect to Wi-Fi", body: "Choose your organization’s Wi-Fi network, enter your work credentials, and reconnect. If the network is missing or your credentials are rejected, send IT a request with your location and device type." },
  { title: "Set up multi-factor authentication", body: "Open Account security, choose Set up authenticator, and scan the code with your authenticator app. Keep your recovery method in a safe place." },
  { title: "Report a lost device", body: "Contact IT as soon as possible. Tell us what device is missing, when you last had it, and how we can reach you. If your account may be exposed, reset your password." },
];

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim().toLowerCase();
  const matches = query ? articles.filter(article => `${article.title} ${article.body}`.toLowerCase().includes(query)) : articles;
  return <div className="portal-page"><header className="portal-page-heading"><div><Link href="/app">← Home</Link><h1>Knowledge base</h1><p>Quick answers to common IT questions.</p></div></header><form className="portal-search"><label htmlFor="help-search">Search help articles</label><div><input className="input" id="help-search" name="q" defaultValue={q} placeholder="What do you need help with?"/><button className="button button-secondary">Search</button></div></form>{matches.length ? <div className="portal-articles">{matches.map(article => <article className="portal-detail-card" key={article.title}><h2>{article.title}</h2><p>{article.body}</p></article>)}</div> : <div className="portal-empty"><h2>No answers found</h2><p>Try different words, or ask IT for help.</p></div>}<p className="portal-help-footer">Still need help? <Link href="/app/tickets/new">Submit a request</Link>.</p></div>;
}
