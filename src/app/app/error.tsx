'use client';
import Link from 'next/link';
export default function WorkspaceError({ retry }: { retry: () => void }) {
  return <div className="page page-narrow"><section className="settings-card"><h1>This page could not load</h1><p role="alert">We couldn’t retrieve the information for this page. Please try again.</p><div className="knowledge-actions"><button className="button button-primary" onClick={retry}>Try again</button><Link className="button button-secondary" href="/app">Back to overview</Link></div></section></div>;
}
