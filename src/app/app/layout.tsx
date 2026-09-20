import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/(auth)/actions";
import { requireViewer } from "@/lib/auth/viewer";
import { rolePresentation } from "@/features/identity/role";

export default async function WorkspaceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const viewer = await requireViewer();
  return <div className="app-shell"><aside className="sidebar"><Link className="brand-mark" href="/app">FixxFlow</Link><nav aria-label="Primary navigation"><ul className="nav-list"><li><Link className="nav-link" href="/app">Overview</Link></li>{viewer.role !== "end_user" && <li><Link className="nav-link" href="/app/people">People</Link></li>}</ul></nav><div className="sidebar-account"><strong>{viewer.displayName}</strong><span>{rolePresentation[viewer.role].label}</span><form action={signOut}><button className="link-button" type="submit">Sign out</button></form></div></aside><main className="workspace" id="main-content">{children}</main></div>;
}
