'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Button } from '@/components/ui/button';

/** Keeps server-rendered identity and account controls outside the client data boundary. */
export function WorkspaceShell({
  brand,
  navigation,
  account,
  audience = 'staff',
  children,
}: {
  brand: ReactNode;
  navigation: ReactNode;
  account: ReactNode;
  children: ReactNode;
  audience?: 'staff' | 'employee';
}) {
  const pathname = usePathname();
  const chatPage = pathname === '/app/chat' || pathname?.startsWith('/app/chat/');
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  useEffect(() => {
    const medium = window.matchMedia('(max-width: 1199px)');
    const sync = () => setCollapsed(medium.matches);
    sync();
    medium.addEventListener('change', sync);
    return () => medium.removeEventListener('change', sync);
  }, []);

  return (
    <div
      className="app-shell"
      data-sidebar={collapsed === null ? 'auto' : collapsed ? 'collapsed' : 'expanded'}
    >
      <aside className="sidebar" aria-label="Workspace sidebar">
        <div className="sidebar-heading">
          <div className="sidebar-identity">
            <div className="sidebar-brand">{brand}</div>
          </div>
          <Button
            variant="quiet"
            size="icon"
            className="sidebar-collapse"
            type="button"
            aria-label={
              collapsed === null
                ? 'Toggle sidebar'
                : collapsed
                  ? 'Expand sidebar'
                  : 'Collapse sidebar'
            }
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-controls="workspace-navigation"
            aria-expanded={collapsed === null ? undefined : !collapsed}
            onClick={() =>
              setCollapsed((value) => !(value ?? window.matchMedia('(max-width: 1199px)').matches))
            }
          >
            <NavigationIcon name="chevronLeft" />
          </Button>
        </div>
        {navigation}
        {account}
      </aside>
      <main
        className={audience === 'employee' ? 'workspace employee-workspace' : 'workspace'}
        id="main-content"
        data-page-flow={chatPage ? undefined : 'standard'}
      >
        {children}
      </main>
    </div>
  );
}
