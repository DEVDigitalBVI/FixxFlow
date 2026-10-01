/** Shared navigation glyphs: 24-unit grid, rounded 1.65px strokes, no font or runtime dependency. */
const glyphs = {
  overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>,
  tickets: <><path d="M20.5 9V6.5a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2V9a3 3 0 0 1 0 6v2.5a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V15a3 3 0 0 1 0-6Z" /><path d="M14.5 7.5v1m0 3v1m0 3v1M7.5 10h3m-3 4h2" /></>,
  chat: <><path d="M8 19.5 3.5 21v-5.5a4 4 0 0 1-1-2.5V7a3.5 3.5 0 0 1 3.5-3.5h12A3.5 3.5 0 0 1 21.5 7v9a3.5 3.5 0 0 1-3.5 3.5Z" /><path d="M7 9h10M7 13h6" /></>,
  knowledge: <><path d="M6.5 3.5h13v17h-13a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3Zm-3 14a3 3 0 0 1 3-3h13M8 3.5v7" /><path d="M12 7.5h4" /></>,
  assets: <><rect x="3" y="4" width="18" height="13" rx="2.5" /><path d="M9 21h6m-3-4v4M3 13.5h18" /></>,
  reports: <><path d="M4 3.5v15a2 2 0 0 0 2 2h14M9 15v-4m5 4V6m5 9V9" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20v-1.5a4 4 0 0 1 4-4H12a4 4 0 0 1 4 4V20M16 4.8a3.5 3.5 0 0 1 0 6.4m3 3.8a4 4 0 0 1 2.5 3.7V20" /></>,
  administration: <><path d="M3.5 6h9m5 0h3M3.5 12h3m5 0h9M3.5 18h11m5 0h1" /><circle cx="15" cy="6" r="2.5" /><circle cx="9" cy="12" r="2.5" /><circle cx="17" cy="18" r="2.5" /></>,
  profile: <><circle cx="12" cy="7.5" r="4" /><path d="M4.5 20.5V19a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1.5" /></>,
  security: <><path d="m12 2.5 8 3V12c0 4.4-3.4 7.7-8 9.5C7.4 19.7 4 16.4 4 12V5.5Z" /><path d="m8.5 11.5 2.5 2.5 4.5-5" /></>,
  support: <><path d="M4 13V11a8 8 0 0 1 16 0v5.5a4 4 0 0 1-4 4h-2" /><rect x="2.5" y="10" width="4" height="7" rx="2" /><rect x="17.5" y="10" width="4" height="7" rx="2" /><path d="M11 20.5h3" /></>,
  notifications: <><path d="M5.5 9a6.5 6.5 0 0 1 13 0v4l2 3.5a1 1 0 0 1-.9 1.5H4.4a1 1 0 0 1-.9-1.5l2-3.5ZM10 21h4" /></>,
  audit: <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9 8h6m-6 4h6m-6 4h3" /></>,
};

export type NavigationIconName = keyof typeof glyphs;

export function NavigationIcon({ name }: { name: NavigationIconName }) {
  return <svg className="navigation-icon" aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{glyphs[name]}</svg>;
}
