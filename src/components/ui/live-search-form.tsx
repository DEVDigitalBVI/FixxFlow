'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { normalizeSearch } from '@/lib/search';

export const SEARCH_DELAY = 300;

/** Serialize the visible controls just like GET, starting a fresh result page. */
export function searchHref(action: string, data: FormData) {
  const params = new URLSearchParams();
  for (const [key, value] of data) {
    if (typeof value !== 'string' || key === 'page') continue;
    const next = key === 'q' ? normalizeSearch(value) : value;
    if (next) params.append(key, next);
  }
  return params.size ? `${action}?${params}` : action;
}

/** Restore URL filters without remounting or moving focus. The first option is
 * each search select's default; unchecked checkboxes are absent from GET URLs. */
export function restoreSearchForm(form: HTMLFormElement, params: URLSearchParams) {
  for (const control of form.elements) {
    if (control instanceof HTMLInputElement) {
      if (control.name === 'q') control.value = normalizeSearch(params.get('q') ?? '');
      else if (control.type === 'checkbox') control.checked = params.getAll(control.name).includes(control.value);
    } else if (control instanceof HTMLSelectElement) {
      const value = params.get(control.name);
      control.value = Array.from(control.options).some(option => option.value === value) ? value! : control.options[0]?.value ?? '';
    }
  }
}

/** Enhance the existing GET form; results and authorization stay on the server. */
export function LiveSearchForm({ action, label, className, children, resultSummary }: {
  action: string;
  label: string;
  className?: string;
  children: ReactNode;
  resultSummary: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams().toString();
  const href = params ? `${pathname}?${params}` : pathname;
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const currentHref = useRef(href);
  const requestedHref = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [searched, setSearched] = useState(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    if (currentHref.current === href) return;
    currentHref.current = href;
    // Our own response must not erase words typed while it was loading.
    // Clear links, pagination and Back/Forward restore server-provided defaults.
    if (requestedHref.current !== href) {
      cancel();
      if (form.current) restoreSearchForm(form.current, new URLSearchParams(params));
    }
    requestedHref.current = null;
  }, [href, params, cancel]);

  useEffect(() => {
    const leave = () => { cancel(); requestedHref.current = null; };
    const followLink = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (link) {
        leave();
        // A clear link can point to the already-committed URL while a draft is
        // waiting. Restore it immediately even when navigation changes no URL.
        if (form.current?.contains(link) && link.pathname === action) restoreSearchForm(form.current, new URLSearchParams(link.search));
      }
    };
    // Cancel before navigation starts, including links outside this form.
    document.addEventListener('click', followLink, true);
    window.addEventListener('popstate', leave);
    return () => {
      cancel();
      document.removeEventListener('click', followLink, true);
      window.removeEventListener('popstate', leave);
    };
  }, [cancel, action]);

  const search = (force = false) => {
    cancel();
    if (!form.current || composing.current) return;
    const next = searchHref(action, new FormData(form.current));
    const retry = next === currentHref.current && requestedHref.current === null;
    if (!force && (retry || next === requestedHref.current)) return;
    requestedHref.current = next;
    setSearched(true);
    startTransition(() => {
      if (retry) router.refresh();
      else router.replace(next, { scroll: false });
    });
  };
  const schedule = () => {
    cancel();
    if (composing.current || !form.current) return;
    // Clearing the field restores the filtered list immediately.
    if (!normalizeSearch(String(new FormData(form.current).get('q') ?? ''))) search();
    else timer.current = setTimeout(search, SEARCH_DELAY);
  };

  return <>
    <form ref={form} action={action} method="get" role="search" aria-label={label} aria-busy={pending} className={className}
      onChange={event => {
        if (event.target instanceof HTMLInputElement && event.target.name === 'q') schedule();
      }}
      onCompositionStart={() => { composing.current = true; cancel(); }}
      onCompositionEnd={() => { composing.current = false; schedule(); }}
      onKeyDown={event => {
        if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
      }}
      onSubmit={event => { event.preventDefault(); search(true); }}>
      {children}
    </form>
    <p className="muted live-search-status" role="status" aria-live="polite" aria-atomic="true">
      {pending ? 'Searching…' : searched ? resultSummary : 'Results update as you type. You can also press Enter or Search.'}
    </p>
  </>;
}
