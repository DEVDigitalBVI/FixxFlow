'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/** Native disclosure with dismissal shared by desktop account menus and mobile navigation. */
export function NavigationDisclosure({ className, summaryClassName, label, summary, children }: { className: string; summaryClassName?: string; label?: string; summary: ReactNode; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const pointerWithin = useRef(false);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const panel = details.current;
      pointerWithin.current = Boolean(panel && event.target instanceof Node && panel.contains(event.target));
      if (panel?.open && event.target instanceof Node && !panel.contains(event.target)) panel.open = false;
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, []);
  return <details className={className} ref={details} onBlurCapture={event => {
    // Safari may blur the summary without focusing a clicked link. Keep that
    // link visible until its click and native navigation have completed.
    if (!event.relatedTarget && pointerWithin.current) return;
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false; trigger.current?.focus();
    }
  }} onClick={event => {
    pointerWithin.current = false;
    if (event.target instanceof Element && event.target.closest('a[href]')) {
      const panel = event.currentTarget;
      setTimeout(() => { panel.open = false; }, 0);
    }
  }}><summary ref={trigger} className={summaryClassName} aria-label={label} title={label}>{summary}</summary>{children}</details>;
}
