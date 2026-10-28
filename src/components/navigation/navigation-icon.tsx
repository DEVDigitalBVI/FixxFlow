/** Shared navigation glyphs: 24-unit grid, rounded 1.65px strokes, no font or runtime dependency. */
const glyphs = {
  chevronLeft: <path d="m14 7-5 5 5 5" />,
  minus: <path d="M5 12h14" />,
  organization: <path d="M4 21V5l8-3v19M12 8h8v13M2 21h20M7 7h2m-2 4h2m-2 4h2m6-3h2m-2 4h2" />,
  automation: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" />,
  routing: <path d="M5 3v12a3 3 0 0 0 3 3h11m-4-4 4 4-4 4M5 6h14m-4-4 4 4-4 4" />,

  arrowLeft: <path d="M20 12H4m6-6-6 6 6 6" />,
  arrowRight: <path d="M4 12h16m-6-6 6 6-6 6" />,
  arrowUpRight: <path d="M6 18 18 6M6 6h12v12" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  signOut: <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m7-4 4-4-4-4m4 4H9" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  chevronRight: <path d="m9 5 7 7-7 7" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),

  inbox: (
    <>
      <path d="m4 4-2 10v6h20v-6L20 4Z" />
      <path d="M2 14h6l2 3h4l2-3h6" />
    </>
  ),
  open: <circle cx="12" cy="12" r="8" />,
  progress: (
    <>
      <circle cx="12" cy="12" r="8" strokeDasharray="26 25" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
    </>
  ),
  priorityLow: <path d="M6 16h12" />,
  priorityNormal: <path d="M6 10h12M6 16h12" />,
  priorityHigh: <path d="M6 5h12M6 11h12M6 17h12" />,
  alert: (
    <>
      <path d="M12 3 2 21h20Z" />
      <path d="M12 9v5m0 3v.1" />
    </>
  ),
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  tickets: (
    <>
      <path d="M20.5 9V6.5a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2V9a3 3 0 0 1 0 6v2.5a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V15a3 3 0 0 1 0-6Z" />
      <path d="M14.5 7.5v1m0 3v1m0 3v1M7.5 10h3m-3 4h2" />
    </>
  ),
  chat: (
    <>
      <path d="M8 19.5 3.5 21v-5.5a4 4 0 0 1-1-2.5V7a3.5 3.5 0 0 1 3.5-3.5h12A3.5 3.5 0 0 1 21.5 7v9a3.5 3.5 0 0 1-3.5 3.5Z" />
      <path d="M7 9h10M7 13h6" />
    </>
  ),
  knowledge: (
    <>
      <path d="M6.5 3.5h13v17h-13a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3Zm-3 14a3 3 0 0 1 3-3h13M8 3.5v7" />
      <path d="M12 7.5h4" />
    </>
  ),
  assets: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2.5" />
      <path d="M9 21h6m-3-4v4M3 13.5h18" />
    </>
  ),
  reports: (
    <>
      <path d="M4 3.5v15a2 2 0 0 0 2 2h14M9 15v-4m5 4V6m5 9V9" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20v-1.5a4 4 0 0 1 4-4H12a4 4 0 0 1 4 4V20M16 4.8a3.5 3.5 0 0 1 0 6.4m3 3.8a4 4 0 0 1 2.5 3.7V20" />
    </>
  ),
  administration: (
    <>
      <path d="M3.5 6h9m5 0h3M3.5 12h3m5 0h9M3.5 18h11m5 0h1" />
      <circle cx="15" cy="6" r="2.5" />
      <circle cx="9" cy="12" r="2.5" />
      <circle cx="17" cy="18" r="2.5" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4.5 20.5V19a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5v1.5" />
    </>
  ),
  security: (
    <>
      <path d="m12 2.5 8 3V12c0 4.4-3.4 7.7-8 9.5C7.4 19.7 4 16.4 4 12V5.5Z" />
      <path d="m8.5 11.5 2.5 2.5 4.5-5" />
    </>
  ),
  support: (
    <>
      <path d="M4 13V11a8 8 0 0 1 16 0v5.5a4 4 0 0 1-4 4h-2" />
      <rect x="2.5" y="10" width="4" height="7" rx="2" />
      <rect x="17.5" y="10" width="4" height="7" rx="2" />
      <path d="M11 20.5h3" />
    </>
  ),
  notifications: (
    <>
      <path d="M5.5 9a6.5 6.5 0 0 1 13 0v4l2 3.5a1 1 0 0 1-.9 1.5H4.4a1 1 0 0 1-.9-1.5l2-3.5ZM10 21h4" />
    </>
  ),
  audit: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
      <path d="M9 8h6m-6 4h6m-6 4h3" />
    </>
  ),
};

export type NavigationIconName = keyof typeof glyphs;

export function NavigationIcon({
  name,
  className = 'navigation-icon',
  size = 20,
}: {
  name: NavigationIconName;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyphs[name]}
    </svg>
  );
}
