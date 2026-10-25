import type { Viewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import type { TicketPriority } from '@/types/database';

import { parseDeadline } from './deadlines';
import { isTicketImpact, ticketImpacts } from './impact';
import { parseIncident } from './incidents';
import { ticketPriorities } from './presentation';

const optional = (value: FormDataEntryValue | null) => String(value ?? '').trim() || null;

/** Validate untrusted input before reference lookups or submission RPCs. */
export function parseTicketInput(
  formData: FormData,
  viewer: Pick<Viewer, 'role' | 'id' | 'timeZone'>,
) {
  const ticketType = formString(formData, 'ticketType', 'support');
  if (
    !['support', 'incident'].includes(ticketType) ||
    (ticketType === 'incident' && viewer.role === 'end_user')
  )
    return { error: 'Only IT staff can declare incidents.' };
  const incident = ticketType === 'incident' ? parseIncident(formData) : null;
  if (incident?.error) return { error: incident.error };
  const title = formString(formData, 'title', '').trim();
  const description = formString(formData, 'description', '').trim();
  const reportedImpact =
    viewer.role === 'end_user' ? formString(formData, 'reportedImpact', '') : null;
  if (reportedImpact !== null && !isTicketImpact(reportedImpact))
    return { error: 'Choose how this issue is affecting work.' };
  const priority = (
    reportedImpact !== null && isTicketImpact(reportedImpact)
      ? ticketImpacts[reportedImpact].priority
      : formString(formData, 'priority', 'normal')
  ) as TicketPriority;
  const requesterId =
    viewer.role === 'end_user' ? viewer.id : (optional(formData.get('requesterId')) ?? viewer.id);
  if (
    title.length < 3 ||
    title.length > 180 ||
    !description ||
    description.length > 20000 ||
    !Object.hasOwn(ticketPriorities, priority)
  )
    return {
      error:
        'Enter a subject of 3–180 characters, a description of up to 20,000 characters, and a valid priority.',
    };
  const submissionKey = formString(formData, 'submissionKey', '');
  if (!isUuid(submissionKey))
    return { error: 'Reload the request form before submitting. Your entries are preserved.' };
  const dueAt =
    viewer.role === 'end_user'
      ? null
      : parseDeadline(
          formString(formData, 'dueAt', ''),
          formString(formData, 'dueTimezone', viewer.timeZone),
          formString(formData, 'dueOccurrence', ''),
        );
  if (dueAt === undefined)
    return {
      error:
        'Enter a valid manual due date in the displayed timezone. If the clock repeats this time, choose its first or second occurrence.',
    };
  return {
    data: {
      title,
      description,
      reportedImpact,
      priority,
      requesterId,
      submissionKey,
      dueAt,
      incident,
    },
  };
}
