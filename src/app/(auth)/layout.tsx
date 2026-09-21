import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="auth-shell"><aside className="auth-brand" aria-label="FixxFlow"><BrandLogo className="auth-logo" variant="dark" priority /><div className="auth-brand-copy"><span className="eyebrow">IT support in motion</span><h2>Keep support work moving.</h2><p>A focused workspace for employees and IT teams to request help, stay informed, and resolve issues faster.</p></div><div className="trust-note"><span className="trust-dot" aria-hidden="true" />Secure organization workspace</div></aside><main className="auth-main" id="main-content"><div className="auth-mobile-brand"><BrandLogo variant="horizontal" priority /></div>{children}</main></div>;
}
