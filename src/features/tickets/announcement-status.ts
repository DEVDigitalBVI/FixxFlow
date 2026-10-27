export const announcementStatuses = {
  investigating: { label: 'Investigating', tone: 'warning' },
  fixing: { label: 'Working on a fix', tone: 'warning' },
  monitoring: { label: 'Monitoring', tone: 'info' },
  resolved: { label: 'Resolved', tone: 'success' },
} as const;
export type AnnouncementStatus = keyof typeof announcementStatuses;
export type AnnouncementDetails = {
  public_status: AnnouncementStatus;
  workaround: string;
  next_update_at: string | null;
};
export function announcementStatus(value: string) {
  return announcementStatuses[value as AnnouncementStatus] ?? announcementStatuses.investigating;
}
