import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';

import { parseDeadline } from './deadlines';

export { isUuid } from '@/lib/ids';

export type CommunicationPlan = {
  ticket_id: string;
  organization_id: string;
  owner_id: string;
  next_update_at: string | null;
  reminded_at: string | null;
  revision: number;
  updated_at: string;
};
export type StakeholderGroup = {
  id: string;
  organization_id: string;
  ticket_id: string;
  name: string;
  archived: boolean;
  revision: number;
  created_at: string;
};
export type StakeholderMember = {
  organization_id: string;
  ticket_id: string;
  group_id: string;
  user_id: string;
};
export type UpdateDraft = {
  id: string;
  organization_id: string;
  ticket_id: string;
  title: string;
  body: string;
  group_ids: string[];
  group_names: string[];
  recipient_ids: string[];
  next_update_at: string | null;
  status: 'draft' | 'sent' | 'discarded';
  revision: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};
export type IncidentBulletin = {
  id: string;
  organization_id: string;
  ticket_id: string;
  title: string;
  body: string;
  next_update_at: string | null;
  prepared_by: string;
  approved_by: string;
  approved_at: string;
  recipient_count: number;
};
export type BulletinRecipient = { organization_id: string; bulletin_id: string; user_id: string };
export type DeliverySummary = {
  bulletin_id: string;
  total: number;
  sent: number;
  pending: number;
  skipped: number;
  failed: number;
};
export function communicationPayload(
  form: FormData,
  operation: string,
):
  | { error: string; data?: never }
  | { data: Record<string, string | string[] | null>; error?: never } {
  const deadline = () =>
    parseDeadline(
      formString(form, 'dueAt', ''),
      formString(form, 'dueTimezone', ''),
      formString(form, 'dueOccurrence', ''),
    );
  if (operation === 'save_plan') {
    const owner_id = formString(form, 'ownerId', ''),
      next_update_at = deadline();
    if (!isUuid(owner_id) || next_update_at === undefined)
      return {
        error:
          'Choose a communication owner and a valid next-update time in the displayed timezone.',
      };
    return { data: { owner_id, next_update_at } };
  }
  if (operation === 'save_group') {
    const name = formString(form, 'name', '').trim();
    if (name.length < 2 || name.length > 100)
      return { error: 'Enter a group name with 2–100 characters.' };
    return { data: { name } };
  }
  if (operation === 'add_member' || operation === 'remove_member') {
    const user_id = formString(form, 'userId', '');
    if (!isUuid(user_id)) return { error: 'Choose a company member.' };
    return { data: { user_id } };
  }
  if (operation === 'save_draft') {
    const title = formString(form, 'title', '').trim(),
      body = formString(form, 'body', '').trim(),
      group_ids = [...new Set(form.getAll('groupId').map(String))],
      next_update_at = deadline();
    if (title.length < 3 || title.length > 180 || body.length < 3 || body.length > 8000)
      return { error: 'Enter a title (3–180 characters) and an update (3–8,000 characters).' };
    if (group_ids.length < 1 || group_ids.length > 10 || !group_ids.every(isUuid))
      return { error: 'Choose 1–10 stakeholder groups.' };
    if (next_update_at === undefined)
      return { error: 'Choose a valid next-update time in the displayed timezone.' };
    return { data: { title, body, group_ids, next_update_at } };
  }
  if (operation === 'publish' && form.get('confirm') !== 'yes')
    return {
      error: 'Review the saved message and audience, then confirm approval before sending.',
    };
  if (['publish', 'discard_draft', 'archive_group'].includes(operation)) return { data: {} };
  return { error: 'This communication action is unavailable.' };
}
