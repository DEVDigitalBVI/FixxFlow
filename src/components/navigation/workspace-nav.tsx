"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NotificationLink } from "@/features/notifications/notification-link";
import type { AppRole } from "@/types/database";

function OverviewIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z" /></svg>;
}

function PeopleIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20m6-8a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 0 0 0-6m3 15v-1.5a3.5 3.5 0 0 0-2.5-3.35" /></svg>;
}
function TicketIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V9a3 3 0 0 0 0 6v2.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V15a3 3 0 0 0 0-6V6.5Z"/><path d="M13 8h3m-3 4h3m-3 4h2"/></svg>; }
function ChatIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 2v-5.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z"/><path d="M7.5 11.5h9m-9 3h6"/></svg>; }

function SettingsIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.5-6-1.5 1.5m-9 9L6 18m12 0-1.5-1.5m-9-9L6 6" /></svg>; }
function ProfileIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg>; }

export function WorkspaceNav({ role, organizationId, userId }: { role: AppRole; organizationId: string; userId: string }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const items = [
    { href: "/app", label: "Overview", icon: <OverviewIcon />, visible: true },
    { href: "/app/tickets", label: "Tickets", icon: <TicketIcon />, visible: true },
    { href: "/app/chat", label: "Live support", icon: <ChatIcon />, visible: role !== "end_user" },
    { href: "/app/people", label: "People", icon: <PeopleIcon />, visible: role !== "end_user" },
    { href: "/app/organization", label: "Organization", icon: <SettingsIcon />, visible: role === "administrator" },
    { href: "/app/profile", label: "Profile", icon: <ProfileIcon />, visible: true },
    { href: "/app/security", label: "Security", icon: <SettingsIcon />, visible: true },
  ];

  useEffect(() => {
    if (!isOpen) return;
    const panel = menuPanelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    focusable?.[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return <>
    <button ref={menuButtonRef} className="mobile-nav-toggle" type="button" aria-controls="workspace-navigation" aria-expanded={isOpen} aria-label={isOpen ? "Close navigation" : "Open navigation"} onClick={() => setIsOpen((open) => !open)}>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </button>
    {isOpen && <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setIsOpen(false)} />}
    <div ref={menuPanelRef} id="workspace-navigation" className={`workspace-nav${isOpen ? " is-open" : ""}`} role={isOpen ? "dialog" : undefined} aria-modal={isOpen ? "true" : undefined} aria-label={isOpen ? "Workspace navigation" : undefined}><nav aria-label="Primary navigation"><ul className="nav-list">{items.filter((item) => item.visible).map((item) => { const active = item.href === "/app" ? pathname === item.href : pathname.startsWith(item.href); return <li key={item.href}><Link className="nav-link" href={item.href} aria-label={item.label} title={item.label} aria-current={active ? "page" : undefined} onClick={() => setIsOpen(false)}>{item.icon}<span>{item.label}</span></Link></li>; })}<li><NotificationLink organizationId={organizationId} userId={userId} className="nav-link" onNavigate={() => setIsOpen(false)} /></li></ul></nav></div>
  </>;
}
