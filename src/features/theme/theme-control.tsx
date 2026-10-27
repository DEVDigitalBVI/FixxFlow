'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { NavigationIcon } from '@/components/navigation/navigation-icon';

import { applyTheme, normalizeTheme, themeStorageKey } from './theme';

const changeEvent = 'fixxflow-theme-change';
function subscribe(notify: () => void) {
  window.addEventListener(changeEvent, notify);
  return () => window.removeEventListener(changeEvent, notify);
}
function snapshot() {
  return normalizeTheme(document.documentElement.dataset.themePreference);
}
function serverSnapshot() {
  return 'system' as const;
}

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
  return (
    <div className="theme-control">
      <span>Appearance</span>
      <div className="theme-options" role="group" aria-label="Appearance">
        {(['system', 'light', 'dark'] as const).map((value) => {
          const label = { system: 'System', light: 'Light', dark: 'Dark' }[value];
          return (
            <button
              key={value}
              type="button"
              className="theme-option"
              aria-label={label}
              title={`${label} appearance`}
              aria-pressed={preference === value}
              onClick={() => {
                applyTheme(value);
                try {
                  localStorage.setItem(themeStorageKey, value);
                } catch {
                  /* Keep the selection for this tab. */
                }
                window.dispatchEvent(new Event(changeEvent));
              }}
            >
              <NavigationIcon
                name={value === 'system' ? 'monitor' : value === 'light' ? 'sun' : 'moon'}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
