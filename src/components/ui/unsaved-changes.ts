'use client';

import { useEffect, useRef } from 'react';

const guards = new Set<() => boolean>();
let approvedUntil = 0;
const warning = 'Discard unsaved changes? Your unfinished work on this page will not be saved.';

function hasUnsavedChanges() {
  for (const guard of guards) if (guard()) return true;
  return false;
}

export function confirmDiscardChanges(force = false) {
  if (Date.now() < approvedUntil || (!force && !hasUnsavedChanges())) return true;
  if (!window.confirm(warning)) return false;
  approvedUntil = Date.now() + 500;
  return true;
}

export function leavesDocument(destination: string, current: string) {
  const next = new URL(destination, current), previous = new URL(current);
  return next.origin !== previous.origin || next.pathname !== previous.pathname || next.search !== previous.search;
}

/** Shared by all mounted drafts; one prompt covers the entire page. */
function install() {
  if (!window.history) return () => {};
  const click = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.download || (link.target && link.target !== '_self')) return;
    if (leavesDocument(link.href, window.location.href) && !confirmDiscardChanges()) {
      event.preventDefault(); event.stopImmediatePropagation(); link.focus();
    }
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (hasUnsavedChanges() && Date.now() >= approvedUntil) { event.preventDefault(); event.returnValue = ''; }
  };
  // Next's soft navigation uses the History API. Track entries without replacing
  // its router state; restore a declined traversal before Next handles popstate.
  const history = window.history;
  let currentUrl = window.location.href;
  let index = Number(history.state?.fixxflowEntry ?? 0);
  const push = history.pushState, replace = history.replaceState;
  replace.call(history, { ...history.state, fixxflowEntry: index }, '');
  history.pushState = function (state, unused, url) { push.call(this, { ...state, fixxflowEntry: ++index }, unused, url); currentUrl = window.location.href; };
  history.replaceState = function (state, unused, url) { replace.call(this, { ...state, fixxflowEntry: index }, unused, url); currentUrl = window.location.href; };
  let restoring = false;
  const pop = (event: PopStateEvent) => {
    if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
    const next = Number(event.state?.fixxflowEntry ?? index - 1);
    if (hasUnsavedChanges() && leavesDocument(window.location.href, currentUrl) && !confirmDiscardChanges()) {
      event.stopImmediatePropagation(); restoring = true; history.go(index - next || 1);
    } else { index = next; currentUrl = window.location.href; }
  };
  document.addEventListener('click', click, true);
  window.addEventListener('beforeunload', unload);
  window.addEventListener('popstate', pop, true);
  return () => {
    document.removeEventListener('click', click, true);
    window.removeEventListener('beforeunload', unload);
    window.removeEventListener('popstate', pop, true);
    history.pushState = push; history.replaceState = replace;
    approvedUntil = 0;
  };
}
let uninstall: (() => void) | undefined;

export function useUnsavedChanges(dirty: boolean) {
  const current = useRef(dirty);
  useEffect(() => { current.current = dirty; }, [dirty]);
  useEffect(() => {
    const guard = () => current.current;
    if (!guards.size) uninstall = install();
    guards.add(guard);
    return () => { guards.delete(guard); if (!guards.size) { uninstall?.(); uninstall = undefined; } };
  }, []);
  return () => { current.current = false; };
}
