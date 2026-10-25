import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/brand/brand-logo';
import { ThemeControl } from '@/features/theme/theme-control';

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="auth-shell">
      <aside className="auth-brand" aria-label="FixxFlow">
        <BrandLogo className="auth-logo" variant="full-inverse" priority />
        <div className="auth-brand-copy">
          <h2>Your IT help starts here.</h2>
          <p>Submit requests, track progress, and stay in touch with your IT team.</p>
        </div>
        <div className="trust-note">
          <span className="trust-dot" aria-hidden="true" />
          Private to your organization
        </div>
      </aside>
      <main className="auth-main" id="main-content">
        <div className="auth-mobile-brand">
          <BrandLogo variant="compact" priority />
        </div>
        {children}
        <div className="auth-appearance">
          <ThemeControl />
        </div>
      </main>
    </div>
  );
}
