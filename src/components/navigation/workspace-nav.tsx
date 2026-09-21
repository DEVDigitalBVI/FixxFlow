"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppRole } from "@/types/database";

function OverviewIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" /></svg>;
}

function PeopleIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20m6-8a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 0 0 0-6m3 15v-1.5a3.5 3.5 0 0 0-2.5-3.35" /></svg>;
}

export function WorkspaceNav({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const items = [
    { href: "/app", label: "Overview", icon: <OverviewIcon />, visible: true },
    { href: "/app/people", label: "People", icon: <PeopleIcon />, visible: role !== "end_user" },
  ];

  return <nav aria-label="Primary navigation"><ul className="nav-list">{items.filter((item) => item.visible).map((item) => { const active = item.href === "/app" ? pathname === item.href : pathname.startsWith(item.href); return <li key={item.href}><Link className="nav-link" href={item.href} aria-current={active ? "page" : undefined}>{item.icon}<span>{item.label}</span></Link></li>; })}</ul></nav>;
}
