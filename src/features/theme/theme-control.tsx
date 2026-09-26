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
  return <div className="theme-control"><span>Appearance</span><div className="theme-options" role="group" aria-label="Appearance">
    {(['system', 'light', 'dark'] as const).map(value => {
      const label = { system: 'System', light: 'Light', dark: 'Dark' }[value];
      return <button key={value} type="button" className="theme-option" aria-label={label} title={`${label} appearance`} aria-pressed={preference === value}
        onClick={() => {
          applyTheme(value);
          try { localStorage.setItem(themeStorageKey, value); } catch { /* Keep the selection for this tab. */ }
          window.dispatchEvent(new Event(changeEvent));
        }}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {value === 'system' ? <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>
            : value === 'light' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>
            : <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>}
        </svg>
      </button>;
    })}
  </div></div>;
}
