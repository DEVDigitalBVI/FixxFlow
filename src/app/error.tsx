"use client";
import Link from "next/link";

/** Includes failures from workspace layouts, before their own error boundary. */
export default function ApplicationError({ retry }: { retry: () => void }) {
  return <main id="main-content" className="page page-narrow"><section className="settings-card"><h1>Your workspace could not load</h1><p role="alert">We could not verify your account information. Please try again.</p><div className="page-header-actions"><button className="button button-primary" onClick={retry}>Try again</button><Link className="button button-secondary" href="/login">Back to sign in</Link></div></section></main>;
}
