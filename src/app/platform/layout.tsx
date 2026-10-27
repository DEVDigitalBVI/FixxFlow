import type { ReactNode } from 'react';

import { signOut } from '@/app/(auth)/actions';
import { BrandLogo } from '@/components/brand/brand-logo';
import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { WorkspaceNav } from '@/components/navigation/workspace-nav';
import { WorkspaceShell } from '@/components/navigation/workspace-shell';
import { Avatar } from '@/components/ui/avatar';
import { platformIdentity } from '@/lib/auth/platform';
import { createClient } from '@/lib/supabase/server';

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const owner = await platformIdentity();
  const db = await createClient();
  const { data: memberships } = await db
    .from('organization_memberships')
    .select('organization_id')
    .eq('user_id', owner.id)
    .eq('status', 'active')
    .limit(1);
  return (
    <WorkspaceShell
      brand={<BrandLogo className="sidebar-logo" variant="navigation" href="/platform" priority />}
      navigation={
        <WorkspaceNav
          role="administrator"
          organizationId=""
          userId={owner.id}
          platform
          workspaceAvailable={!!memberships?.length}
          signOutControl={
            <form action={signOut}>
              <button className="button button-secondary" type="submit">
                Sign out
              </button>
            </form>
          }
        />
      }
      account={
        <div className="sidebar-account">
          <Avatar name="Platform owner" />
          <div className="account-copy">
            <strong>Platform owner</strong>
            <span>{owner.email}</span>
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
  );
}
