import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Avatar } from "@/components/ui/avatar";
import { WorkspaceNav } from "@/components/navigation/workspace-nav";
import { requireViewer } from "@/lib/auth/viewer";
import { rolePresentation } from "@/features/identity/role";

export default async function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const viewer = await requireViewer();
  if (viewer.role === "end_user") return <div className="portal-shell"><header className="portal-header"><BrandLogo variant="horizontal" href="/app" className="portal-logo" priority /><nav aria-label="Employee navigation"><Link href="/app">Home</Link><Link href="/app/tickets">My tickets</Link><Link href="/app/help">Knowledge base</Link><Link href="/app/profile">Account</Link></nav><form action={signOut}><button className="portal-signout" type="submit">Sign out</button></form></header><main id="main-content" className="portal-main">{children}</main></div>;
  return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><BrandLogo className="sidebar-logo-full" variant="horizontal" href="/app" priority /><BrandLogo className="sidebar-logo-icon" variant="icon" href="/app" priority /></div><WorkspaceNav role={viewer.role} /><div className="sidebar-account"><Avatar name={viewer.displayName} src={viewer.avatarUrl} /><div className="account-copy"><strong>{viewer.displayName}</strong><span>{rolePresentation[viewer.role].label}</span></div><form action={signOut}><button className="sign-out-button" type="submit" aria-label="Sign out" title="Sign out"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m7-4 4-4-4-4m4 4H9" /></svg></button></form></div></aside><main className="workspace" id="main-content">{children}</main></div>;
}
