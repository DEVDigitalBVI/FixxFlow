import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="auth-shell"><aside className="auth-brand" aria-label="FixxFlow"><Link className="brand-mark" href="/">FixxFlow</Link><div className="auth-brand-copy"><h2>Support work, flowing clearly.</h2><p>A calm workspace for employees and IT teams to request, track, and resolve support.</p></div><small>Secure organization workspace</small></aside><main className="auth-main" id="main-content">{children}</main></div>;
}
