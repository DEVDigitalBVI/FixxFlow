import 'server-only';

import type { Viewer } from '@/lib/auth/viewer';
import { reportServerError } from '@/lib/server-errors';
import type { createClient } from '@/lib/supabase/server';

import type { parseTicketInput } from './create-input';

const optional = (value: FormDataEntryValue | null) => String(value ?? '').trim() || null;
type TicketInput = NonNullable<ReturnType<typeof parseTicketInput>['data']>;
/** Persist an already validated request using the appropriate idempotent RPC. */
export async function submitNewTicket(
  supabase: Awaited<ReturnType<typeof createClient>>,
  viewer: Pick<Viewer, 'role' | 'organizationId'>,
  input: TicketInput,
  formData: FormData,
  classification: { categoryId: string | null; subcategoryId: string | null },
) {
  const {
    title,
    description,
    reportedImpact,
    priority,
    requesterId,
    submissionKey,
    dueAt,
    incident,
  } = input;
  const assetId = viewer.role === 'end_user' ? optional(formData.get('assetId')) : null;
  if (assetId) {
    const { data: equipmentTicket, error: equipmentError } = await supabase.rpc(
      'submit_support_request',
      {
        org: viewer.organizationId,
        token: submissionKey,
        kind: 'equipment',
        payload: {
          asset: assetId,
          title,
          description,
          reported_impact: reportedImpact,
          category_id: classification.categoryId,
        },
      },
    );
    if (equipmentError?.code === 'PT409')
      return {
        error:
          'This equipment request was already saved with different details. Check your tickets before starting a new request.',
      };
    if (equipmentError || !equipmentTicket)
      return {
        error:
          'Your equipment request could not be sent. Check that the equipment is still assigned to you and try again.',
      };
    return { redirectTo: `/app/tickets/${equipmentTicket}?success=Request sent.` };
  }
  const automaticRouting =
    viewer.role === 'end_user' || !formData.has('teamId') || formData.get('teamId') === 'automatic';
  const payload = {
    requester_id: requesterId,
    title,
    description,
    reported_impact: reportedImpact,
    priority,
    routing_mode: automaticRouting ? 'automatic' : 'manual',
    team_id: automaticRouting ? null : optional(formData.get('teamId')),
    category_id: classification.categoryId,
    subcategory_id: classification.subcategoryId,
    location_id: optional(formData.get('locationId')),
    assigned_technician_id:
      viewer.role === 'end_user' ? null : optional(formData.get('assignedTechnicianId')),
    due_at: dueAt,
    ...(incident?.data ? { incident: incident.data } : {}),
  };
  const { data, error } = incident?.data
    ? await supabase.rpc('submit_incident_ticket', {
        org: viewer.organizationId,
        token: submissionKey,
        payload,
      })
    : await supabase.rpc('submit_support_request', {
        org: viewer.organizationId,
        token: submissionKey,
        kind: 'ticket',
        payload,
      });
  if (error?.code === 'PT409')
    return {
      error:
        'This request was already saved with different details. Check your tickets before starting a new request.',
    };
  if (error || !data) {
    reportServerError('ticket.create', error);
    return {
      error: 'Your request could not be sent. Your entries are preserved; please try again.',
    };
  }
  return { redirectTo: `/app/tickets/${data}?success=Request sent.` };
}
