import type { TicketPriority } from '@/types/database';

import { fixedSlaTargets } from './sla-policy';

export type SlaSchedule = { days: number[]; opens: number; closes: number };
export type SlaTargets = Record<TicketPriority, { response: number; resolution: number }>;
export type OrganizationSlaPolicy = { version: number; targets: SlaTargets; schedule: SlaSchedule };
export const defaultSlaSchedule: SlaSchedule = {
  days: [1, 2, 3, 4, 5, 6, 7],
  opens: 420,
  closes: 1320,
};
export const defaultSlaTargets = Object.fromEntries(
  fixedSlaTargets.map(({ priority, response, resolution }) => [priority, { response, resolution }]),
) as SlaTargets;
export const slaDays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
export function validSchedule(value: unknown): value is SlaSchedule {
  if (!value || typeof value !== 'object') return false;
  const s = value as SlaSchedule;
  return (
    Array.isArray(s.days) &&
    s.days.length > 0 &&
    s.days.length <= 7 &&
    new Set(s.days).size === s.days.length &&
    s.days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) &&
    Number.isInteger(s.opens) &&
    Number.isInteger(s.closes) &&
    s.opens >= 0 &&
    s.closes <= 1440 &&
    s.opens < s.closes
  );
}
export function validTargets(value: unknown): value is SlaTargets {
  if (!value || typeof value !== 'object') return false;
  return fixedSlaTargets.every(({ priority }) => {
    const row = (value as SlaTargets)[priority];
    return (
      row &&
      [row.response, row.resolution].every((n) => Number.isInteger(n) && n >= 1 && n <= 525600) &&
      row.response <= row.resolution
    );
  });
}
export function parseSlaPolicy(value: unknown): OrganizationSlaPolicy {
  const policy = value as OrganizationSlaPolicy | null;
  if (
    !policy ||
    !Number.isInteger(policy.version) ||
    policy.version < 0 ||
    !validTargets(policy.targets) ||
    !validSchedule(policy.schedule)
  )
    throw new Error('Unable to load SLA settings. Please try again.');
  return policy;
}
export function policyTargets(targets: unknown) {
  const values = validTargets(targets) ? targets : defaultSlaTargets;
  return fixedSlaTargets.map(({ priority }) => ({ priority, ...values[priority] }));
}
export function scheduleDescription(value?: unknown) {
  const s = validSchedule(value) ? value : defaultSlaSchedule;
  const time = (minutes: number) => {
    if (minutes === 1440) return 'midnight';
    const hour = Math.floor(minutes / 60),
      rest = minutes % 60;
    return `${hour % 12 || 12}${rest ? ':' + String(rest).padStart(2, '0') : ''} ${hour >= 12 ? 'PM' : 'AM'}`;
  };
  const days =
    s.days.length === 7
      ? 'every day'
      : s.days.map((day) => slaDays[day - 1].slice(0, 3)).join(', ');
  return `${time(s.opens)}–${time(s.closes)} ${days}`;
}
export function scheduleTime(minutes: number) {
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
