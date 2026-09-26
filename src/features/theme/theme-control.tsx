'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { applyTheme, normalizeTheme, themeStorageKey } from './theme';

const changeEvent = 'fixxflow-theme-change';
function subscribe(notify: () => void) {
  window.addEventListener(changeEvent, notify);
  return () => window.removeEventListener(changeEvent, notify);
}
function snapshot() { return normalizeTheme(document.documentElement.dataset.themePreference); }
function serverSnapshot() { return 'system' as const; }

export function ThemeController() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystem = () => applyTheme(snapshot());
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== themeStorageKey && event.key !== null) return;
      applyTheme(normalizeTheme(event.newValue));
      window.dispatchEvent(new Event(changeEvent));
    };
    syncSystem();
    media.addEventListener('change', syncSystem);
    window.addEventListener('storage', syncStorage);
    return () => {
      media.removeEventListener('change', syncSystem);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);
  return null;
}

export function ThemeControl() {
  const preference = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <label className="theme-control" title="Appearance"><span>Appearance</span><span className="theme-control-icon" aria-hidden="true">◐</span><select
    className="input" value={preference}
    onChange={event => {
      const next = normalizeTheme(event.target.value);
      applyTheme(next);
      try { localStorage.setItem(themeStorageKey, next); } catch { /* Keep the selection for this tab. */ }
      window.dispatchEvent(new Event(changeEvent));
    }}
  ><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>;
}
