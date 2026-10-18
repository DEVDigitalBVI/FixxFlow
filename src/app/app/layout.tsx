import { TimezoneProvider } from '@/features/timezones/provider';
import { inventoryAccess } from '@/features/inventory/access';
import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import { BrandLogo } from "@/components/brand/brand-logo";
import { ViewerAvatar } from "@/features/identity/viewer-avatar";
import { WorkspaceShell } from "@/components/navigation/workspace-shell";
import { WorkspaceNav } from "@/components/navigation/workspace-nav";
import { requireViewer } from "@/lib/auth/viewer";
import { rolePresentation } from "@/features/identity/role";

export default async function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const viewer = await requireViewer();
  const inventory = await inventoryAccess(viewer);
  return <TimezoneProvider timeZone={viewer.timeZone} preference={viewer.timezonePreference}><WorkspaceShell audience={viewer.role === "end_user" ? "employee" : "staff"} brand={<BrandLogo className="sidebar-logo" variant="navigation" href="/app" priority />} navigation={<WorkspaceNav inventoryAccess={inventory.manager || inventory.departments.length > 0} role={viewer.role} organizationId={viewer.organizationId} userId={viewer.id} />} account={<div className="sidebar-account"><ViewerAvatar name={viewer.displayName} /><div className="account-copy"><strong>{viewer.displayName}</strong><span>{rolePresentation[viewer.role].label}</span></div><form action={signOut}><button className="sign-out-button" type="submit" aria-label="Sign out" title="Sign out"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m7-4 4-4-4-4m4 4H9" /></svg></button></form></div>}>{children}</WorkspaceShell></TimezoneProvider>;
}
