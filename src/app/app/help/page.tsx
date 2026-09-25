import Link from "next/link";

import { searchArticles } from "@/features/knowledge/articles";

export default async function HelpPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim().toLowerCase();
  const matches = searchArticles(query);
  return <div className="portal-page"><header className="portal-page-heading"><div><Link href="/app">← Home</Link><h1>Knowledge base</h1><p>Quick answers to common IT questions.</p></div></header><form className="portal-search"><label htmlFor="help-search">Search help articles</label><div><input className="input" id="help-search" name="q" defaultValue={q} placeholder="What do you need help with?"/><button className="button button-secondary">Search</button></div></form>{matches.length ? <div className="portal-articles">{matches.map(article => <article className="portal-detail-card" key={article.title}><h2>{article.title}</h2><p>{article.body}</p></article>)}</div> : <div className="portal-empty"><h2>No answers found</h2><p>Try different words, or ask IT for help.</p></div>}<p className="portal-help-footer">Still need help? <Link href="/app/tickets/new">Submit a request</Link>.</p></div>;
}
