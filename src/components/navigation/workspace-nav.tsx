"use client";

import Link from "next/link";
import { NavigationDisclosure } from "./navigation-disclosure";
import { GlobalSearch } from '@/features/search/global-search';
import { NavigationIcon } from "./navigation-icon";
import { ThemeControl } from "@/features/theme/theme-control";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NotificationLink } from "@/features/notifications/notification-link";
import type { AppRole } from "@/types/database";

export function WorkspaceNav({ role, organizationId, userId, platform = false, workspaceAvailable = true, inventoryAccess = false }: { platform?: boolean; workspaceAvailable?: boolean; inventoryAccess?: boolean; role: AppRole; organizationId: string; userId: string }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const items = platform ? [
    { href: "/platform/customers", label: "Customers", icon: <NavigationIcon name="people" />, visible: true },
    { href: "/platform/analytics", label: "Product analytics", icon: <NavigationIcon name="reports" />, visible: true },
    { href: "/platform/audit", label: "Platform audit", icon: <NavigationIcon name="audit" />, visible: true },
    { href: "/app", label: "My workspace", icon: <NavigationIcon name="tickets" />, visible: workspaceAvailable },
  ] : [
    { href: "/app", label: role === "end_user" ? "Home" : "Dashboard", icon: <NavigationIcon name="overview" />, visible: true },
    { href: "/app/tickets", label: role === "end_user" ? "My requests" : "Tickets", icon: <NavigationIcon name="tickets" />, visible: true },
    { href: "/app/chat", label: role === "end_user" ? "My chats" : "Live chat", icon: <NavigationIcon name="chat" />, visible: true },
    { href: "/app/help", label: role === "end_user" ? "Help articles" : "Knowledge base", icon: <NavigationIcon name="knowledge" />, visible: true },
    { href: "/app/inventory", label: role === "end_user" ? "Request an item" : "Inventory", icon: <NavigationIcon name="assets" />, visible: inventoryAccess },
    { href: "/app/assets", label: role === "end_user" ? "My equipment" : "Assets", icon: <NavigationIcon name="assets" />, visible: true },
    { href: "/app/reports", label: "Reports", icon: <NavigationIcon name="reports" />, visible: role !== "end_user" },
    { href: "/app/people", label: "People", icon: <NavigationIcon name="people" />, visible: role !== "end_user" },
    { href: "/app/administration", label: "Settings", icon: <NavigationIcon name="administration" />, visible: role === "administrator" },
    { href: "/app/profile", label: role === "end_user" ? "Account" : "Profile", icon: <NavigationIcon name="profile" />, visible: true },
    { href: "/app/security", label: "Security", icon: <NavigationIcon name="security" />, visible: true },
    { href: "/app/support", label: "Contact support", icon: <NavigationIcon name="support" />, visible: true },
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
    const focusable = panel?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), select:not([disabled]), summary");
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
      const controls = Array.from(focusable).filter(control => control.getClientRects().length > 0);
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

  function linksFor(hrefs?: readonly string[]) {
    return items.filter(item => item.visible && (!hrefs || hrefs.includes(item.href))).map(item => {
      const active = item.href === '/app' ? pathname === item.href : pathname.startsWith(item.href) || (item.href === '/app/administration' && pathname.startsWith('/app/organization'));
      return <li key={item.href} className={item.href === '/app/profile' ? 'nav-account-start' : undefined}><Link className="nav-link" href={item.href} aria-label={item.label} title={item.label} aria-current={active ? 'page' : undefined} onClick={closeMenu}>{item.icon}<span>{item.label}</span></Link></li>;
    });
  }
  const employeePrimary = ['/app', '/app/tickets', '/app/help'];
  const employeeSecondary = items.map(item => item.href).filter(href => !employeePrimary.includes(href));
  const staffWork = ['/app', '/app/tickets', '/app/chat'];
  const staffResources = ['/app/help', '/app/inventory', '/app/assets'];
  const staffManage = ['/app/reports', '/app/people', '/app/administration'];
  const staffAccount = ['/app/profile', '/app/security', '/app/support'];
  const accountActive = staffAccount.some(path => pathname.startsWith(path));
  return <>
    <button ref={menuButtonRef} className="mobile-nav-toggle" type="button" aria-controls="workspace-navigation" aria-expanded={isOpen} aria-label={isOpen ? "Close navigation" : "Open navigation"} onClick={() => setIsOpen((open) => !open)}>
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span aria-hidden="true" />
    </button>
    {isOpen && <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" tabIndex={-1} onClick={closeMenu} />}
    <div ref={menuPanelRef} id="workspace-navigation" className={`workspace-nav${isOpen ? " is-open" : ""}`} role={isOpen ? "dialog" : undefined} aria-modal={isOpen ? "true" : undefined} aria-label={isOpen ? "Workspace navigation" : undefined}><button className="button button-secondary nav-close" type="button" onClick={closeMenu}>Close navigation</button><GlobalSearch role={role} inventoryAccess={inventoryAccess} onOpen={closeMenu} platform={platform} workspaceAvailable={workspaceAvailable}/><nav aria-label={role === "end_user" ? "Employee navigation" : "Primary navigation"}>{platform ? <ul className="nav-list">{linksFor()}</ul> : role === 'end_user' ? <><ul className="nav-list">{linksFor(employeePrimary)}</ul><NavigationDisclosure className="employee-more-nav" summaryClassName="button button-quiet" summary="Account"><ul className="nav-list">{linksFor(employeeSecondary)}<li><NotificationLink organizationId={organizationId} userId={userId} className="nav-link" onNavigate={closeMenu}/></li></ul></NavigationDisclosure></> : <>
      <div className="nav-group"><span className="nav-group-label">Work</span><ul className="nav-list">{linksFor(staffWork)}<li><NotificationLink organizationId={organizationId} userId={userId} className="nav-link" onNavigate={closeMenu}/></li></ul></div>
      <div className="nav-group"><span className="nav-group-label">Resources</span><ul className="nav-list">{linksFor(staffResources)}</ul></div>
      <div className="nav-group"><span className="nav-group-label">Manage</span><ul className="nav-list">{linksFor(staffManage)}</ul></div>
    </>}</nav>{!platform && role !== 'end_user' && <NavigationDisclosure className="staff-more-nav" summaryClassName="nav-link" label="Account" summary={<><NavigationIcon name="profile"/><span data-active={accountActive || undefined}>Account</span></>}><ul className="nav-list">{linksFor(staffAccount)}</ul></NavigationDisclosure>}<ThemeControl /></div>
  </>;
}
