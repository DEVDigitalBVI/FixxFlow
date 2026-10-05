export type ThemePreference = 'light' | 'dark' | 'system';
export const themeStorageKey = 'fixxflow-theme';
export function normalizeTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
}
// Self-contained so the same initializer can run before the first paint.
export function initializeTheme() {
  let preference = 'system';
  try {
    const saved = localStorage.getItem('fixxflow-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch { /* Storage can be unavailable in private or restricted browsers. */ }
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
}
export const themeScript = `(${initializeTheme.toString()})()`;
