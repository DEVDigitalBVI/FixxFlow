'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { SEARCH_HINT, SEARCH_LIMIT } from '@/lib/search';
import type { LookupPage, LookupResource } from './model';

export function LookupSelect({ resource, name, label, defaultValue = '', value, onChange, parentId, required = false, emptyLabel = 'Not selected', specialOptions = [], activeOnly = true, guardSave = true, describedBy }: {
  resource: LookupResource; name: string; label: string; defaultValue?: string; value?: string;
  onChange?: (value: string) => void; parentId?: string; required?: boolean; emptyLabel?: string;
  specialOptions?: { id: string; label: string }[]; activeOnly?: boolean; guardSave?: boolean; describedBy?: string;
}) {
  const id = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const immediate = useRef(false);
  const [local, setLocal] = useState(defaultValue);
  const selected = value ?? local;
  const [query, setQuery] = useState('');
  const [cursors, setCursors] = useState<string[]>(['']);
  const [retry, setRetry] = useState(0);
  const [composing, setComposing] = useState(false);
  const [state, setState] = useState<{ data: LookupPage; pending: boolean; error: boolean }>({ data: { rows: [], selected: null, next: null }, pending: true, error: false });
  const cursor = cursors.at(-1) ?? '';
  const selectedId = selected && !specialOptions.some(option => option.id === selected) ? selected : '';
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const delay = immediate.current ? 0 : query ? 300 : 0;
    immediate.current = false;
    const timer = setTimeout(async () => {
      if (composing) return;
      setState(previous => ({ ...previous, pending: true, error: false }));
      const params = new URLSearchParams({ resource, q: query, cursor, selected: selectedId, parent: parentId ?? '', active: activeOnly ? 'true' : 'all' });
      try {
        const response = await fetch(`/app/lookups?${params}`, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
        if (!response.ok) throw new Error('Lookup failed');
        const data: LookupPage = await response.json();
        if (!Array.isArray(data.rows) || data.rows.some(row => typeof row.id !== 'string' || typeof row.label !== 'string') || (data.next !== null && typeof data.next !== 'string')) throw new Error('Invalid lookup');
        if (!cancelled) {
          setState({ data, pending: false, error: false });
        }
      } catch { if (!cancelled) setState(previous => ({ ...previous, pending: false, error: true })); }
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [resource, query, cursor, selectedId, parentId, activeOnly, retry, composing]);

  const current = state.data.selected?.id === selected ? state.data.selected : null;
  const choices = [...new Map([...(current ? [current] : []), ...state.data.rows].map(row => [row.id, row])).values()];
  const unavailable = Boolean(selectedId && !state.pending && !state.error && !choices.some(row => row.id === selectedId));
  const busy = state.pending || composing;
  const search = (text: string) => { setQuery(text); setCursors(['']); setState(previous => ({ ...previous, pending: true })); };
  return <div className="field lookup-picker">
    <label htmlFor={id}>{label}{required ? ' *' : ''}</label>
    <label className="sr-only" htmlFor={`${id}-search`}>Search {label.toLowerCase()}</label>
    <input ref={searchInput} id={`${id}-search`} className="input" type="search" value={query} maxLength={SEARCH_LIMIT} placeholder={`Search ${label.toLowerCase()}`} aria-describedby={`${id}-hint`} onChange={event => { event.stopPropagation(); search(event.target.value); }} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!composing) { immediate.current = true; setRetry(number => number + 1); } } }}/>
    <small id={`${id}-hint`} className="muted">{SEARCH_HINT}</small>
    <select id={id} className="input" name={name} value={selected} required={required} aria-describedby={[`${id}-status`, describedBy].filter(Boolean).join(' ')} onChange={event => {
      const next = event.target.value;
      setState(previous => ({ ...previous, data: { ...previous.data, selected: choices.find(row => row.id === next) ?? null } }));
      setLocal(next); onChange?.(next);
    }}>
      <option value="">{emptyLabel}</option>
      {specialOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      {selectedId && !choices.some(row => row.id === selectedId) && <option value={selectedId}>{busy ? 'Loading current selection…' : 'Current selection unavailable'}</option>}
      {choices.map(row => <option key={row.id} value={row.id} disabled={activeOnly && !row.active && row.id !== selected}>{row.label}{!row.active ? ' (inactive)' : ''}</option>)}
    </select>
    {guardSave && (busy || state.error || unavailable) && <input type="hidden" name="lookupLoadError" value="true"/>}
    <span id={`${id}-status`} className="muted" role="status">{busy ? 'Loading choices…' : state.error ? 'Choices could not load. Your selection is preserved. Try again before saving.' : unavailable ? 'Current selection is unavailable. Choose a replacement or clear it before saving.' : !state.data.rows.length ? 'No matches. Try a different search.' : `Page ${cursors.length} · ${state.data.rows.length} ${state.data.rows.length === 1 ? "choice" : "choices"}`}</span>
    <div className="lookup-actions">
      {state.error && <button type="button" className="button button-secondary" onClick={() => { immediate.current = true; searchInput.current?.focus(); setState(previous => ({ ...previous, pending: true })); setRetry(number => number + 1); }}>Try again</button>}
      {query && <button type="button" className="button button-quiet" onClick={() => { search(''); searchInput.current?.focus(); }}>Clear search</button>}
      <button type="button" className="button button-quiet" disabled={busy || cursors.length === 1} onClick={() => { setState(previous => ({ ...previous, pending: true })); setCursors(previous => previous.slice(0, -1)); }}>Previous choices</button>
      <button type="button" className="button button-quiet" disabled={busy || state.error || !state.data.next} onClick={() => { setState(previous => ({ ...previous, pending: true })); setCursors(previous => [...previous, state.data.next!]); }}>More choices</button>
    </div>
  </div>;
}
