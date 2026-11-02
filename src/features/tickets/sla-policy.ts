// Defaults for workspaces without custom SLA standards and pre-policy ticket history.
// The regression test keeps these aligned with the database defaults.
export const fixedSlaTargets = [
  { priority: 'critical', response: 15, resolution: 240 },
  { priority: 'high', response: 60, resolution: 480 },
  { priority: 'normal', response: 240, resolution: 1440 },
  { priority: 'low', response: 480, resolution: 2880 },
] as const;
export function formatMinutes(minutes: number) {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} ${minutes === 60 ? 'hr' : 'hrs'}`;
}
