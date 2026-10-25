import { formString } from '@/lib/form-data';

import { isUuid } from './communications';
import { parseDeadline } from './deadlines';

export type EscalationPolicy = {
  ticket_id: string;
  organization_id: string;
  backup_owner_id: string | null;
  enabled: boolean;
  acknowledgement_minutes: number;
  overdue_minutes: number;
  revision: number;
  updated_at: string;
};
export const approvalStates = {
  pending: { label: 'Awaiting decision', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
} as const;
export type IncidentApproval = {
  id: string;
  organization_id: string;
  ticket_id: string;
  step_id: string | null;
  step_work_version: number | null;
  step_snapshot: import('./response-checklist').IncidentStep | null;
  title: string;
  description: string;
  approver_id: string;
  backup_approver_id: string | null;
  due_at: string;
  requested_by: string;
  requested_at: string;
  status: keyof typeof approvalStates;
  decision_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  superseded_by: string | null;
  revision: number;
};
export const escalationReasons = {
  acknowledgement_missed: 'Missed acknowledgement',
  step_overdue: 'Overdue response step',
  approval_overdue: 'Overdue approval',
  communication_overdue: 'Overdue stakeholder update',
} as const;
export type IncidentEscalation = {
  id: number;
  organization_id: string;
  ticket_id: string;
  target_id: string;
  reason: keyof typeof escalationReasons;
  event_key: string;
  recipient_ids: string[];
  created_at: string;
};
export type ApprovalHistory = {
  id: number;
  organization_id: string;
  ticket_id: string;
  approval_id: string;
  actor_id: string;
  action: string;
  snapshot: IncidentApproval;
  created_at: string;
};
export type ControlChange = {
  id: number;
  organization_id: string;
  ticket_id: string;
  actor_id: string;
  action: string;
  snapshot: {
    policy?: EscalationPolicy;
    previous_owner_id?: string;
    owner_id?: string;
    backup_owner_id?: string | null;
  };
  created_at: string;
};
export type ControlHistoryRow = { id: number; title: string; at: string; description: string };
export function mayDecide(approval: IncidentApproval, userId: string, now: number) {
  return (
    approval.status === 'pending' &&
    !approval.superseded_by &&
    approval.requested_by !== userId &&
    (approval.approver_id === userId ||
      (approval.backup_approver_id === userId && Date.parse(approval.due_at) <= now))
  );
}
export function parseControl(
  form: FormData,
  operation: string,
):
  | { error: string; data?: never }
  | { data: Record<string, string | number | boolean | null>; error?: never } {
  if (operation === 'save_policy') {
    const backup_owner_id = formString(form, 'backupOwnerId', ''),
      enabled = form.get('enabled') === 'yes',
      acknowledgement_minutes = Number(form.get('acknowledgementMinutes')),
      overdue_minutes = Number(form.get('overdueMinutes'));
    if (
      (backup_owner_id && !isUuid(backup_owner_id)) ||
      (enabled && !backup_owner_id) ||
      !Number.isInteger(acknowledgement_minutes) ||
      acknowledgement_minutes < 1 ||
      acknowledgement_minutes > 1440 ||
      !formString(form, 'overdueMinutes', '').trim() ||
      !Number.isInteger(overdue_minutes) ||
      overdue_minutes < 0 ||
      overdue_minutes > 1440
    )
      return {
        error:
          'Choose a backup owner to enable escalation. Set acknowledgement time to 1–1,440 minutes and overdue grace to 0–1,440 minutes.',
      };
    return {
      data: {
        backup_owner_id: backup_owner_id || null,
        enabled,
        acknowledgement_minutes,
        overdue_minutes,
      },
    };
  }
  if (operation === 'request_approval') {
    const title = formString(form, 'title', '').trim(),
      description = formString(form, 'description', '').trim(),
      approver_id = formString(form, 'approverId', ''),
      backup_approver_id = formString(form, 'backupApproverId', ''),
      step_id = formString(form, 'stepId', '');
    const due_at = parseDeadline(
      formString(form, 'dueAt', ''),
      formString(form, 'dueTimezone', ''),
      formString(form, 'dueOccurrence', ''),
    );
    if (
      title.length < 3 ||
      title.length > 180 ||
      description.length < 3 ||
      description.length > 4000 ||
      !isUuid(approver_id) ||
      (backup_approver_id && (!isUuid(backup_approver_id) || backup_approver_id === approver_id)) ||
      (step_id && !isUuid(step_id)) ||
      !due_at
    )
      return {
        error:
          'Enter the decision title (3–180 characters), details (3–4,000), an approver, and a valid deadline. Any backup approver must be different.',
      };
    return {
      data: {
        title,
        description,
        approver_id,
        backup_approver_id: backup_approver_id || null,
        step_id: step_id || null,
        due_at,
      },
    };
  }
  if (['approve', 'reject', 'cancel_approval'].includes(operation)) {
    const note = formString(form, 'note', '').trim();
    if (note.length < 3 || note.length > 2000)
      return { error: 'Record a decision reason with 3–2,000 characters.' };
    if (form.get('confirm') !== 'yes')
      return { error: 'Review the saved request and confirm your decision.' };
    return { data: { note } };
  }
  if (operation === 'take_over') {
    if (form.get('confirm') !== 'yes')
      return { error: 'Confirm that you will take over incident coordination.' };
    return { data: {} };
  }
  return { error: 'This incident control action is unavailable.' };
}
