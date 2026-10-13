import { ThemeControl } from "@/features/theme/theme-control";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="auth-shell"><aside className="auth-brand" aria-label="FixxFlow"><BrandLogo className="auth-logo" variant="horizontal" priority /><div className="auth-brand-copy"><span className="eyebrow">IT support in motion</span><h2>Support, kept in motion.</h2><p>One clear place to request help, keep people informed, and move technical work to resolution.</p></div><div className="trust-note"><span className="trust-dot" aria-hidden="true" />Private to your organization</div></aside><main className="auth-main" id="main-content"><div className="auth-mobile-brand"><BrandLogo variant="compact" priority /></div>{children}<div className="auth-appearance"><ThemeControl /></div></main></div>;
}
