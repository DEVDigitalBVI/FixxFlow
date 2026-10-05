export type Report = {
  asOf: string; timezone: string; today: string;
  summary: { created: number; resolved: number; open: number; overdue: number; response: number | null; resolution: number | null };
  daily: { day: string; created: number; resolved: number; reopened: number; response: number | null; resolution: number | null }[];
  breakdowns: { kind: string; label: string; value: number }[];
  sla: { label: string; total: number; met: number }[];
};
export function duration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return 'No data';
  if (minutes < 1) return '<1m';
  return minutes < 60 ? `${Math.round(minutes)}m` : `${(minutes / 60).toFixed(1)}h`;
}
export function topRows(rows: { label: string; value: number }[]) {
  const sorted = [...rows].sort((a,b) => b.value-a.value || a.label.localeCompare(b.label));
  return sorted.length <= 10 ? sorted : [...sorted.slice(0,10), {label:'Other groups',value:sorted.slice(10).reduce((sum,row)=>sum+row.value,0)}];
}
