import type { ReactNode } from 'react';

import { signOut } from '@/app/(auth)/actions';
import { BrandLogo } from '@/components/brand/brand-logo';
import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { WorkspaceNav } from '@/components/navigation/workspace-nav';
import { WorkspaceShell } from '@/components/navigation/workspace-shell';
import { Button } from '@/components/ui/button';
import { rolePresentation } from '@/features/identity/role';
import { ViewerAvatar } from '@/features/identity/viewer-avatar';
import { inventoryAccess } from '@/features/inventory/access';
import { TimezoneProvider } from '@/features/timezones/provider';
import { requireViewer } from '@/lib/auth/viewer';

export default async function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const viewer = await requireViewer();
  const inventory = await inventoryAccess(viewer);
  return (
    <TimezoneProvider timeZone={viewer.timeZone} preference={viewer.timezonePreference}>
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
              <form action={signOut}>
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
            <form action={signOut}>
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
    </TimezoneProvider>
  );
}
