import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/brand/brand-logo';
import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { WorkspaceNav } from '@/components/navigation/workspace-nav';
import { WorkspaceShell } from '@/components/navigation/workspace-shell';
import { Button } from '@/components/ui/button';
import { SessionGuard } from '@/features/auth/session-guard';
import { rolePresentation } from '@/features/identity/role';
import { ViewerAvatar } from '@/features/identity/viewer-avatar';
import { inventoryAccess } from '@/features/inventory/access';
import { TimezoneProvider } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';

import productStyles from '../product.module.css';

export default async function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const viewer = await requireViewer();
  const inventory = await inventoryAccess(viewer);
  return (
    <div className={productStyles.scope}>
      <TimezoneProvider timeZone={viewer.timeZone} preference={viewer.timezonePreference}>
        <SessionGuard userId={viewer.id}>
          <WorkspaceShell
            audience={viewer.role === 'end_user' ? 'employee' : 'staff'}
            brand={<BrandLogo className="sidebar-logo" variant="navigation" href="/app" priority />}
            navigation={
              <WorkspaceNav
                inventoryAccess={inventory.manager || inventory.departments.length > 0}
                role={viewer.role}
                organizationId={viewer.organizationId}
                userId={viewer.id}
                signOutControl={
                  <form action="/auth/sign-out" method="post">
                    <Button variant="secondary" type="submit">
                      Sign out
                    </Button>
                  </form>
                }
              />
            }
            account={
              <div className="sidebar-account">
                <ViewerAvatar name={viewer.displayName} />
                <div className="account-copy">
                  <strong>{viewer.displayName}</strong>
                  <span>{rolePresentation[viewer.role].label}</span>
                </div>
                <form action="/auth/sign-out" method="post">
                  <button
                    className="sign-out-button"
                    type="submit"
                    aria-label="Sign out"
                    title="Sign out"
                  >
                    <NavigationIcon name="signOut" />
                  </button>
                </form>
              </div>
            }
          >
            {children}
          </WorkspaceShell>
        </SessionGuard>
      </TimezoneProvider>
    </div>
  );
}
