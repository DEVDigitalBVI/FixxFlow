'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { NotificationLink } from '@/features/notifications/notification-link';
import { GlobalSearch } from '@/features/search/global-search';
import { ThemeControl } from '@/features/theme/theme-control';
import type { AppRole } from '@/types/database';

import { NavigationDisclosure } from './navigation-disclosure';
import { NavigationIcon } from './navigation-icon';

export function WorkspaceNav({
  role,
  organizationId,
  userId,
  platform = false,
  workspaceAvailable = true,
  inventoryAccess = false,
  signOutControl,
}: {
  /** Shown at the end of the compact navigation sheet; the sidebar keeps its own. */
  signOutControl?: ReactNode;
  platform?: boolean;
  workspaceAvailable?: boolean;
  inventoryAccess?: boolean;
  role: AppRole;
  organizationId: string;
  userId: string;
}) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const items = platform
    ? [
        {
          href: '/platform/customers',
          label: 'Customers',
          icon: <NavigationIcon name="people" />,
          visible: true,
        },
        {
          href: '/platform/analytics',
          label: 'Product analytics',
          icon: <NavigationIcon name="reports" />,
          visible: true,
        },
        {
          href: '/platform/library',
          label: 'FixxFlow library',
          icon: <NavigationIcon name="knowledge" />,
          visible: true,
        },
        {
          href: '/platform/audit',
          label: 'Platform audit',
          icon: <NavigationIcon name="audit" />,
          visible: true,
        },
        {
          href: '/app',
          label: 'My workspace',
          icon: <NavigationIcon name="tickets" />,
          visible: workspaceAvailable,
        },
      ]
    : [
        {
          href: '/app',
          label: role === 'end_user' ? 'Home' : 'Dashboard',
          icon: <NavigationIcon name="overview" />,
          visible: true,
        },
        {
          href: '/app/tickets',
          label: role === 'end_user' ? 'My requests' : 'Tickets',
          icon: <NavigationIcon name="tickets" />,
          visible: true,
        },
        {
          href: '/app/chat',
          label: role === 'end_user' ? 'My chats' : 'Live chat',
          icon: <NavigationIcon name="chat" />,
          visible: true,
        },
        {
          href: '/app/help',
          label: role === 'end_user' ? 'Help articles' : 'Knowledge base',
          icon: <NavigationIcon name="knowledge" />,
          visible: true,
        },
        {
          href: '/app/inventory',
          label: role === 'end_user' ? 'Request an item' : 'Inventory',
          icon: <NavigationIcon name="assets" />,
          visible: inventoryAccess,
        },
        {
          href: '/app/assets',
          label: role === 'end_user' ? 'My equipment' : 'Assets',
          icon: <NavigationIcon name="assets" />,
          visible: true,
        },
        {
          href: '/app/reports',
          label: 'Reports',
          icon: <NavigationIcon name="reports" />,
          visible: role !== 'end_user',
        },
        {
          href: '/app/people',
          label: 'People',
          icon: <NavigationIcon name="people" />,
          visible: role !== 'end_user',
        },
        {
          href: '/app/administration',
          label: 'Settings',
          icon: <NavigationIcon name="administration" />,
          visible: role === 'administrator',
        },
        {
          href: '/app/profile',
          label: 'Profile',
          icon: <NavigationIcon name="profile" />,
          visible: true,
        },
        {
          href: '/app/security',
          label: 'Security',
          icon: <NavigationIcon name="security" />,
          visible: true,
        },
        {
          href: '/app/support',
          label: 'Contact support',
          icon: <NavigationIcon name="support" />,
          visible: true,
        },
      ];

  function closeMenu() {
    setIsOpen(false);
  }

  // Radix handles focus containment, Escape, scroll locking and focus return. Keep the page
  // inert as well, and close the sheet when the viewport grows into the persistent sidebar.
  useEffect(() => {
    if (!isOpen) return;
    const main = document.getElementById('main-content');
    const previousInert = main?.inert ?? false;
    if (main) main.inert = true;
    const desktop = window.matchMedia('(min-width: 768px)');
    const onResize = () => {
      if (desktop.matches) setIsOpen(false);
    };
    desktop.addEventListener('change', onResize);
    return () => {
      desktop.removeEventListener('change', onResize);
      if (main) main.inert = previousInert;
    };
  }, [isOpen]);

  // Cycle explicitly: Safari can omit links from its native Tab order.
  function cycleFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), summary',
      ),
    ).filter((control) => control.getClientRects().length > 0);
    if (!controls.length) return;
    event.preventDefault();
    const current = controls.indexOf(document.activeElement as HTMLElement);
    const next =
      current < 0
        ? event.shiftKey
          ? controls.length - 1
          : 0
        : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    controls[next].focus();
  }

  function linksFor(hrefs?: readonly string[]) {
    return items
      .filter((item) => item.visible && (!hrefs || hrefs.includes(item.href)))
      .map((item) => {
        const active =
          item.href === '/app'
            ? pathname === item.href
            : pathname.startsWith(item.href) ||
              (item.href === '/app/administration' && pathname.startsWith('/app/organization'));
        return (
          <li
            key={item.href}
            className={item.href === '/app/profile' ? 'nav-account-start' : undefined}
          >
            <Link
              className="nav-link"
              href={item.href}
              aria-label={item.label}
              title={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={closeMenu}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          </li>
        );
      });
  }
  const primaryPaths = ['/app', '/app/tickets', '/app/chat'];
  const resourcePaths = ['/app/help', '/app/inventory', '/app/assets'];
  const managePaths = ['/app/reports', '/app/people', '/app/administration'];
  const accountPaths = ['/app/profile', '/app/security', '/app/support'];
  const accountActive = accountPaths.some((path) => pathname.startsWith(path));
  const panel = (
    <>
      <SheetClose asChild>
        <Button variant="secondary" className="nav-close" type="button">
          Close navigation
        </Button>
      </SheetClose>
      <GlobalSearch
        role={role}
        inventoryAccess={inventoryAccess}
        onOpen={closeMenu}
        platform={platform}
        workspaceAvailable={workspaceAvailable}
      />
      <nav aria-label={role === 'end_user' ? 'Employee navigation' : 'Primary navigation'}>
        {platform ? (
          <>
            <ul className="nav-list nav-group" aria-label="Platform">
              {linksFor([
                '/platform/customers',
                '/platform/analytics',
                '/platform/library',
                '/platform/audit',
              ])}
            </ul>
            {workspaceAvailable && (
              <ul className="nav-list nav-group" aria-label="Workspace">
                {linksFor(['/app'])}
              </ul>
            )}
          </>
        ) : (
          <>
            <ul
              className="nav-list nav-group"
              aria-label={role === 'end_user' ? 'Support' : 'Work'}
            >
              {linksFor(primaryPaths)}
              <li>
                <NotificationLink
                  organizationId={organizationId}
                  userId={userId}
                  className="nav-link"
                  onNavigate={closeMenu}
                />
              </li>
            </ul>
            <ul className="nav-list nav-group" aria-label="Resources">
              {linksFor(resourcePaths)}
            </ul>
            {role !== 'end_user' && (
              <ul className="nav-list nav-group" aria-label="Manage">
                {linksFor(managePaths)}
              </ul>
            )}
          </>
        )}
      </nav>
      {!platform && (
        <NavigationDisclosure
          className="staff-more-nav"
          summaryClassName="nav-link"
          label="Account"
          summary={
            <>
              <NavigationIcon name="profile" />
              <span data-active={accountActive || undefined}>Account</span>
            </>
          }
        >
          <ul className="nav-list">{linksFor(accountPaths)}</ul>
          {/* Infrequent setting: kept with account controls so short screens fit the nav. */}
          <ThemeControl />
        </NavigationDisclosure>
      )}
      {platform && <ThemeControl />}
      {signOutControl && <div className="nav-sign-out">{signOutControl}</div>}
    </>
  );
  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          ref={menuButtonRef}
          variant="quiet"
          size="icon"
          className="mobile-nav-toggle"
          type="button"
          aria-controls="workspace-navigation"
          aria-label={isOpen ? 'Close navigation' : 'Open navigation'}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </Button>
      </SheetTrigger>
      {isOpen ? (
        <SheetContent
          portal={false}
          id="workspace-navigation"
          className="workspace-nav is-open block"
          overlayClassName="mobile-nav-backdrop"
          aria-label="Workspace navigation"
          aria-describedby={undefined}
          onKeyDown={cycleFocus}
          onPointerDownOutside={(event) => {
            // The toggle stays visible above the sheet and closes it itself.
            if (menuButtonRef.current?.contains(event.target as Node)) event.preventDefault();
          }}
        >
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          {panel}
        </SheetContent>
      ) : (
        <div id="workspace-navigation" className="workspace-nav">
          {panel}
        </div>
      )}
    </Sheet>
  );
}
