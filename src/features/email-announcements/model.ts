export const emailAnnouncementsPath = '/app/administration/announcements';
export type AnnouncementMember = { user_id: string; display_name: string; email: string };
export type AnnouncementChoices = { rows: AnnouncementMember[]; total: number };
export type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
export const deliveryLabels: Record<DeliveryStatus, string> = {
  pending: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Skipped',
};
export type EmailCounts = {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  skipped: number;
};
export function announcementSent(counts: EmailCounts) {
  return counts.pending === 0 && counts.failed === 0 && counts.sent > 0;
}
export type EmailAnnouncement = {
  id: string;
  subject: string;
  body: string;
  created_at: string;
  queued_at: string | null;
  member_selection?: string[] | null;
};
export type EmailAnnouncementList = {
  total: number;
  campaigns: (Omit<EmailAnnouncement, 'body'> & EmailCounts)[];
};
export type EmailAnnouncementReview = {
  campaign: EmailAnnouncement;
  counts: EmailCounts;
  selection?: AnnouncementMember[];
  recipients: { user_id: string; display_name: string; email: string; status: DeliveryStatus }[];
};
export type EmailAnnouncementDelivery = {
  campaign_id: string;
  user_id: string;
  lease_token: string;
  recipient_email: string;
  subject: string;
  body: string;
  workspace_name: string;
};
export function campaignStatus(queued: string | null, counts: EmailCounts) {
  if (!queued) return 'Draft';
  if (counts.pending) return 'Sending';
  if (counts.failed) return 'Needs attention';
  return 'Complete';
}
