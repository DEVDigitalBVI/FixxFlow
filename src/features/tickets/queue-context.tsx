'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import { confirmDiscardChanges } from '@/components/ui/unsaved-changes';

import { ticketDetailHref } from './queue-navigation';

const queuePositions = new Map<string, { y: number; selected: string[] }>();

/** Queue stays mounted behind the panel, including scroll and bulk selection. */
export function TicketQueueContext({
  children,
  panel,
  selected,
  returnTo,
  allowDrawer = true,
}: {
  children: ReactNode;
  panel: ReactNode;
  selected?: string;
  returnTo: string;
  allowDrawer?: boolean;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const queue = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const openedHere = useRef(false);
  const hasPanel = Boolean(panel);
  useEffect(() => {
    const saved = queuePositions.get(returnTo),
      node = queue.current;
    if (!saved || !node) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: saved.y });
      node.querySelectorAll<HTMLInputElement>('input[name="ticketIds"]').forEach((input) => {
        input.checked = saved.selected.includes(input.value);
      });
      node
        .querySelector('form#bulk-ticket-form')
        ?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [returnTo]);
  function close() {
    if (!confirmDiscardChanges()) return;
    if (openedHere.current) router.back();
    else router.replace(returnTo, { scroll: false });
  }
  useEffect(() => {
    if (!hasPanel) {
      trigger.current?.focus({ preventScroll: true });
      return;
    }
    heading.current?.focus({ preventScroll: true });
    const background = new Map<HTMLElement, boolean>();
    let branch: HTMLElement | null = drawer.current;
    while (branch?.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement)
          background.set(sibling, sibling.inert);
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    const overflow = document.body.style.overflow;
    const compact = window.matchMedia('(max-width: 1199px)');
    const sync = () => {
      background.forEach((inert, element) => {
        element.inert = compact.matches || inert;
      });
      document.body.style.overflow = compact.matches ? 'hidden' : overflow;
      drawer.current?.setAttribute('aria-modal', String(compact.matches));
    };
    sync();
    compact.addEventListener('change', sync);
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        drawer.current?.querySelector<HTMLButtonElement>('[data-close-ticket]')?.click();
      }
      if (compact.matches && event.key === 'Tab') {
        const controls = Array.from(
          drawer.current?.querySelectorAll<HTMLElement>(
            'a[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex="0"]',
          ) ?? [],
        ).filter((node) => node.getClientRects().length && !node.matches(':disabled'));
        if (controls.length) {
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
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      background.forEach((inert, element) => {
        element.inert = inert;
      });
      document.body.style.overflow = overflow;
      compact.removeEventListener('change', sync);
      window.removeEventListener('keydown', key);
    };
  }, [hasPanel, selected]);
  return (
    <div className={hasPanel ? 'ticket-queue-context has-detail' : 'ticket-queue-context'}>
      <div
        ref={queue}
        onClickCapture={(event) => {
          const link =
            event.target instanceof Element
              ? event.target.closest<HTMLAnchorElement>('a[data-queue-ticket]')
              : null;
          if (
            !link ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          queuePositions.set(returnTo, {
            y: window.scrollY,
            selected: Array.from(
              queue.current?.querySelectorAll<HTMLInputElement>(
                'input[name="ticketIds"]:checked',
              ) ?? [],
            ).map((input) => input.value),
          });
          if (queuePositions.size > 20) queuePositions.delete(queuePositions.keys().next().value!);
          if (!allowDrawer || !window.matchMedia('(min-width: 1200px)').matches) return;
          event.preventDefault();
          trigger.current = link;
          if (!hasPanel) openedHere.current = true;
          const url = new URL(returnTo, window.location.origin);
          url.searchParams.set('ticket', link.dataset.queueTicket!);
          if (hasPanel) router.replace(url.pathname + url.search, { scroll: false });
          else router.push(url.pathname + url.search, { scroll: false });
        }}
      >
        {children}
      </div>
      {hasPanel && (
        <aside
          ref={drawer}
          className="ticket-detail-drawer"
          role="dialog"
          aria-labelledby="ticket-panel-heading"
        >
          <header className="ticket-panel-toolbar">
            <h2 id="ticket-panel-heading" ref={heading} tabIndex={-1}>
              Ticket details
            </h2>
            <button type="button" className="button button-quiet" data-close-ticket onClick={close}>
              Close details
            </button>
            <a className="button button-secondary" href={ticketDetailHref(selected!, returnTo)}>
              Open full ticket
            </a>
          </header>
          {panel}
        </aside>
      )}
    </div>
  );
}
