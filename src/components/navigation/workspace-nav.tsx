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

function BookIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v15M12 5C8 2 4 3 3 4v15c3-2 6-1 9 1 3-2 6-3 9-1V4c-1-1-5-2-9 1Z" /></svg>; }
function SettingsIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm0-12v2m0 13v2m8.5-8.5h-2m-13 0h-2m14.5-6-1.5 1.5m-9 9L6 18m12 0-1.5-1.5m-9-9L6 6" /></svg>; }
function ProfileIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></svg>; }

export function WorkspaceNav({ role, organizationId, userId, platform = false, workspaceAvailable = true }: { platform?: boolean; workspaceAvailable?: boolean; role: AppRole; organizationId: string; userId: string }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const items = platform ? [
    { href: "/platform/customers", label: "Customers", icon: <PeopleIcon />, visible: true },
    { href: "/platform/analytics", label: "Product analytics", icon: <OverviewIcon />, visible: true },
    { href: "/platform/audit", label: "Platform audit", icon: <BookIcon />, visible: true },
    { href: "/app", label: "My workspace", icon: <TicketIcon />, visible: workspaceAvailable },
  ] : [
    { href: "/app", label: role === "end_user" ? "Home" : "Overview", icon: <OverviewIcon />, visible: true },
    { href: "/app/tickets", label: role === "end_user" ? "My tickets" : "Tickets", icon: <TicketIcon />, visible: true },
    { href: "/app/chat", label: role === "end_user" ? "My chats" : "Chats", icon: <ChatIcon />, visible: true },
    { href: "/app/help", label: role === "end_user" ? "Help articles" : "Knowledge base", icon: <BookIcon />, visible: true },
    { href: "/app/assets", label: role === "end_user" ? "My equipment" : "Assets", icon: <SettingsIcon />, visible: true },
    { href: "/app/reports", label: "Reports", icon: <OverviewIcon />, visible: role !== "end_user" },
    { href: "/app/people", label: "People", icon: <PeopleIcon />, visible: role !== "end_user" },
    { href: "/app/administration", label: "Administration", icon: <SettingsIcon />, visible: role === "administrator" },
    { href: "/app/profile", label: role === "end_user" ? "Account" : "Profile", icon: <ProfileIcon />, visible: true },
    { href: "/app/security", label: "Security", icon: <SettingsIcon />, visible: true },
  ];

  function closeMenu() {
    setIsOpen(false);
    if (isOpen) menuButtonRef.current?.focus();
  }

  useEffect(() => {
    if (!isOpen) return;
    const panel = menuPanelRef.current;
    const main = document.getElementById("main-content");
    const previousInert = main?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    if (main) main.inert = true;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 768px)");
    const onResize = () => { if (desktop.matches) setIsOpen(false); };
    desktop.addEventListener("change", onResize);
    const focusable = panel?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    const focusFrame = window.requestAnimationFrame(() => focusable?.[0]?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      // Cycle explicitly: Safari can omit links from its native Tab order.
      event.preventDefault();
      const controls = Array.from(focusable);
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = current < 0
        ? (event.shiftKey ? controls.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next].focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      desktop.removeEventListener("change", onResize);
      if (main) main.inert = previousInert;
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  return <>
    <button ref={menuButtonRef} className="mobile-nav-toggle" type="button" aria-controls="workspace-navigation" aria-expanded={isOpen} aria-label={isOpen ? "Close navigation" : "Open navigation"} onClick={() => setIsOpen((open) => !open)}>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </button>
    {isOpen && <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" tabIndex={-1} onClick={closeMenu} />}
    <div ref={menuPanelRef} id="workspace-navigation" className={`workspace-nav${isOpen ? " is-open" : ""}`} role={isOpen ? "dialog" : undefined} aria-modal={isOpen ? "true" : undefined} aria-label={isOpen ? "Workspace navigation" : undefined}><button className="button button-secondary nav-close" type="button" onClick={closeMenu}>Close navigation</button><nav aria-label={role === "end_user" ? "Employee navigation" : "Primary navigation"}><ul className="nav-list">{items.filter((item) => item.visible).map((item) => { const active = item.href === "/app" ? pathname === item.href : (pathname.startsWith(item.href) || (item.href === "/app/administration" && pathname.startsWith("/app/organization"))); return <li key={item.href} className={item.href === "/app/profile" ? "nav-account-start" : undefined}><Link className="nav-link" href={item.href} aria-label={item.label} title={item.label} aria-current={active ? "page" : undefined} onClick={closeMenu}>{item.icon}<span>{item.label}</span></Link></li>; })}{!platform && <li><NotificationLink organizationId={organizationId} userId={userId} className="nav-link" onNavigate={closeMenu} /></li>}</ul></nav></div>
  </>;
}
