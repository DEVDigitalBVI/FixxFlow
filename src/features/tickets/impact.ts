export const ticketImpacts = {
  minor_inconvenience: { priority: 'low', label: 'Minor inconvenience', description: 'I can still work.' },
  work_blocked: { priority: 'normal', label: 'Work blocked', description: 'I can’t complete an important task.' },
  team_affected: { priority: 'high', label: 'Team affected', description: 'Several people can’t work normally.' },
  operations_stopped: { priority: 'critical', label: 'Operations stopped', description: 'A critical business service is unavailable.' },
} as const;
export type TicketImpact = keyof typeof ticketImpacts;
export function isTicketImpact(value: string): value is TicketImpact {
  return Object.hasOwn(ticketImpacts, value);
}
