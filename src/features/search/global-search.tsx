'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { confirmDiscardChanges } from '@/components/ui/unsaved-changes';
import { normalizeSearch, SEARCH_LIMIT } from '@/lib/search';
import type { AppRole } from '@/types/database';

import {
  groupSearchResults,
  matchDestinations,
  SEARCH_RESULT_LIMIT,
  searchDestinations,
  type SearchResult,
} from './model';

export function GlobalSearch({
  role,
  inventoryAccess,
  onOpen,
  platform = false,
  workspaceAvailable = true,
}: {
  role: AppRole;
  inventoryAccess: boolean;
  onOpen: () => void;
  platform?: boolean;
  workspaceAvailable?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [remote, setRemote] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle'),
    [selected, setSelected] = useState(0),
    [retry, setRetry] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const composing = useRef(false),
    router = useRouter();
  const destinations = useMemo<SearchResult[]>(
    () =>
      platform
        ? [
            {
              id: 'customers',
              label: 'Customers',
              href: '/platform/customers',
              group: 'Navigation',
            },
            {
              id: 'analytics',
              label: 'Product analytics',
              href: '/platform/analytics',
              group: 'Navigation',
            },
            { id: 'audit', label: 'Platform audit', href: '/platform/audit', group: 'Navigation' },
            ...(workspaceAvailable
              ? [
                  {
                    id: 'workspace',
                    label: 'My workspace',
                    href: '/app',
                    group: 'Navigation' as const,
                  },
                ]
              : []),
          ]
        : searchDestinations(role, inventoryAccess),
    [platform, workspaceAvailable, role, inventoryAccess],
  );
  const normalizedQuery = normalizeSearch(query);
  const navigationResults = useMemo(
    () => matchDestinations(destinations, normalizedQuery),
    [destinations, normalizedQuery],
  );
  const results = useMemo(() => [...navigationResults, ...remote], [navigationResults, remote]);
  const groups = useMemo(() => groupSearchResults(results, true), [results]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'k' &&
        !event.isComposing
      ) {
        event.preventDefault();
        returnFocus.current = document.activeElement as HTMLElement;
        onOpen();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [onOpen]);
  // Opening search can close the mobile navigation that contained its trigger, so focus returns
  // to the first control that is still visible rather than Radix's default trigger.
  function restoreFocus() {
    const visible = (node: HTMLElement | null) =>
      node &&
      node.getClientRects().length &&
      window.getComputedStyle(node).visibility === 'visible' &&
      !node.closest('[inert]');
    const target = visible(returnFocus.current)
      ? returnFocus.current
      : visible(trigger.current)
        ? trigger.current
        : document.querySelector<HTMLElement>('.mobile-nav-toggle');
    target?.focus();
  }
  useEffect(() => {
    if (!open || platform || !normalizedQuery) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (composing.current) return;
      try {
        const response = await fetch(`/app/search?${new URLSearchParams({ q: normalizedQuery })}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error();
        const payload = await response.json();
        if (!controller.signal.aborted) {
          setRemote(payload.results);
          setStatus('idle');
          setSelected(0);
        }
      } catch {
        if (!controller.signal.aborted) setStatus('error');
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, normalizedQuery, retry, platform]);
  function change(value: string) {
    setQuery(value);
    setRemote([]);
    setSelected(0);
    setStatus(normalizeSearch(value) && !platform ? 'loading' : 'idle');
  }
  function choose(result: SearchResult) {
    if (!confirmDiscardChanges()) return;
    setOpen(false);
    router.push(result.href);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        ref={trigger}
        type="button"
        variant="secondary"
        className="global-search-trigger"
        aria-label="Search"
        title="Search (⌘/Ctrl K)"
        onClick={() => {
          returnFocus.current = trigger.current;
          onOpen();
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        <span className="global-search-label">
          <NavigationIcon name="search" />
          <span>Search</span>
        </span>
        <kbd aria-hidden="true">⌘/Ctrl K</kbd>
      </Button>
      <DialogContent
        className="global-search-dialog"
        aria-labelledby="global-search-title"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <header className="search-dialog-heading">
          <DialogTitle asChild>
            <h2 id="global-search-title">
              {platform ? 'Find a destination' : 'Search your workspace'}
            </h2>
          </DialogTitle>
          <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
            Close search
          </Button>
        </header>
        <label htmlFor="global-search-input">
          {platform
            ? 'Search navigation'
            : role === 'end_user'
              ? 'Tickets and articles'
              : 'Tickets, people and articles'}
        </label>
        <Input
          ref={input}
          id="global-search-input"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="global-search-results"
          aria-activedescendant={results[selected] ? `global-result-${selected}` : undefined}
          aria-describedby="global-search-hint"
          maxLength={SEARCH_LIMIT}
          value={query}
          onChange={(event) => change(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            change(event.currentTarget.value);
            setRetry((value) => value + 1);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              return;
            }
            if (results.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault();
              const next =
                (selected + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
              setSelected(next);
              document
                .getElementById(`global-result-${next}`)
                ?.scrollIntoView({ block: 'nearest' });
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              if (results[selected]) choose(results[selected]);
            }
          }}
        />
        <p className="form-note" id="global-search-hint">
          ↑ ↓ to choose · Enter to open · Escape to close.
        </p>
        <p role="status">
          {status === 'loading'
            ? 'Searching…'
            : status === 'error'
              ? 'Workspace results unavailable.'
              : `${results.length} ${results.length === 1 ? 'result' : 'results'}${remote.length >= SEARCH_RESULT_LIMIT ? ' · Best matches shown · Refine your search for more' : ''}.`}
        </p>
        {status === 'error' && (
          <Alert role="alert" tone="error">
            Workspace results could not load.{' '}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStatus('loading');
                setRetry((value) => value + 1);
                input.current?.focus();
              }}
            >
              Retry search
            </Button>
          </Alert>
        )}
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="global-search-results"
        >
          {groups.map(({ label, entries }) => (
            <div key={label} role="group" aria-label={label}>
              <p className="form-note" aria-hidden="true">
                {label === 'Navigation' ? 'Shortcuts' : label}
              </p>
              {entries.map(({ result, index }) => (
                <a
                  key={`${result.group}-${result.id}`}
                  id={`global-result-${index}`}
                  href={result.href}
                  role="option"
                  aria-selected={selected === index}
                  tabIndex={-1}
                  className="global-search-result"
                  onMouseMove={() => setSelected(index)}
                  onClick={(event) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey ||
                      event.button !== 0
                    )
                      return;
                    event.preventDefault();
                    choose(result);
                  }}
                >
                  <small>
                    {
                      {
                        Navigation: 'Shortcut',
                        Tickets: 'Ticket',
                        People: 'Person',
                        Articles: 'Article',
                      }[result.group]
                    }
                    {result.approximate ? ' · Similar match' : ''}
                  </small>
                  <strong>{result.label}</strong>
                  {result.detail && <span>{result.detail}</span>}
                </a>
              ))}
            </div>
          ))}
        </div>
        {!results.length && status === 'idle' && (
          <p>No results. Try fewer words or a ticket number.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
