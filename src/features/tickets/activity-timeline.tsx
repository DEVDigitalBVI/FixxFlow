import type { Json } from '@/types/database';
import { Timestamp } from '@/features/timezones/provider';
import { activityAuthorName } from './authorship';
import { activityLabels, ticketPriorities, ticketStatuses } from './presentation';

type Activity = { id: string | number; actor_id: string | null; action: string; details?: Json; created_at: string };
const record = (details: Json | undefined): Record<string, Json | undefined> => details && typeof details === 'object' && !Array.isArray(details) ? details : {};
const label = (value: Json | undefined, mapping: Record<string, { label: string }>) => typeof value === 'string' && Object.hasOwn(mapping, value) ? mapping[value].label : null;

export function activityProfileIds(rows: Activity[]): string[] {
  return [...new Set(rows.flatMap(row => {
    const details = record(row.details);
    return [row.actor_id, ...(row.action === 'assignment_changed' ? [details.from, details.to] : [])].filter((id): id is string => typeof id === 'string' && Boolean(id));
  }))];
}

export function activityDetail(row: Activity, names: ReadonlyMap<string, string>): string | null {
  const details = record(row.details);
  if (row.action === 'status_changed' || row.action === 'priority_changed') {
    const mapping = row.action === 'status_changed' ? ticketStatuses : ticketPriorities;
    const from = label(details.from, mapping), to = label(details.to, mapping);
    return from && to ? `${from} → ${to}` : to ? `Changed to ${to}` : null;
  }
  if (row.action === 'assignment_changed') {
    const person = (id: Json | undefined) => id === null ? 'Unassigned' : typeof id === 'string' ? names.get(id) ?? 'Staff member' : null;
    const from = person(details.from), to = person(details.to);
    return from && to ? `${from} → ${to}` : to ? `Assigned to ${to}` : null;
  }
  if (row.action === 'created') {
    const status = label(details.status, ticketStatuses), priority = label(details.priority, ticketPriorities);
    return [status && `Status: ${status}`, priority && `Priority: ${priority}`].filter(Boolean).join(' · ') || null;
  }
  if (row.action === 'automatically_routed' && typeof details.team_name === 'string') return `Team: ${details.team_name}`;
  return null;
}

export function ActivityTimeline({ items, names }: { items: Activity[]; names: ReadonlyMap<string, string> }) {
  return <ol className="ticket-activity-list" role="list" aria-label="Ticket activity, newest first">{items.map(item => {
    const detail = activityDetail(item, names);
    return <li className="ticket-activity-item" key={item.id}>
      <span className="ticket-activity-marker" aria-hidden="true" />
      <div className="ticket-activity-content"><p><strong>{activityAuthorName(item.actor_id, item.details, names)}</strong> {activityLabels[item.action] ?? item.action.replaceAll('_', ' ')}</p>{detail && <p className="ticket-activity-detail">{detail}</p>}</div>
      <time dateTime={item.created_at}><Timestamp value={item.created_at} /></time>
    </li>;
  })}</ol>;
}
