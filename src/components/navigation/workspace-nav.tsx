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
function TicketIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V9a3 3 0 0 0 0 6v2.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V15a3 3 0 0 0 0-6V6.5Z"/><path d="M13 8h3m-3 4h3m-3 4h2"/></svg>; }

function SettingsIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.5-6-1.5 1.5m-9 9L6 18m12 0-1.5-1.5m-9-9L6 6" /></svg>; }
function ProfileIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg>; }

export function WorkspaceNav({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const items = [
    { href: "/app", label: "Overview", icon: <OverviewIcon />, visible: true },
    { href: "/app/tickets", label: "Tickets", icon: <TicketIcon />, visible: true },
    { href: "/app/people", label: "People", icon: <PeopleIcon />, visible: role !== "end_user" },
    { href: "/app/organization", label: "Organization", icon: <SettingsIcon />, visible: role === "administrator" },
    { href: "/app/profile", label: "Profile", icon: <ProfileIcon />, visible: true },
    { href: "/app/security", label: "Security", icon: <SettingsIcon />, visible: true },
  ];

  return <nav aria-label="Primary navigation"><ul className="nav-list">{items.filter((item) => item.visible).map((item) => { const active = item.href === "/app" ? pathname === item.href : pathname.startsWith(item.href); return <li key={item.href}><Link className="nav-link" href={item.href} aria-current={active ? "page" : undefined}>{item.icon}<span>{item.label}</span></Link></li>; })}</ul></nav>;
}
