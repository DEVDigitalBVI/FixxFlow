'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { parseTicketInput } from '@/features/tickets/create-input';
import { submitNewTicket } from '@/features/tickets/create-service';
import { parseDeadline } from '@/features/tickets/deadlines';
import { parseIncident } from '@/features/tickets/incidents';
import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';
import type { TicketMessageKind, TicketPriority, TicketStatus } from '@/types/database';

const optional = (value: FormDataEntryValue | null) => String(value ?? '').trim() || null;
const fail = (path: string, message: string): never =>
  redirect(`${path}?${new URLSearchParams({ error: message })}`);

type Classification = { categoryId: string | null; subcategoryId: string | null };

async function classificationError(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  selection: Classification,
  previous?: Classification,
) {
  const { categoryId, subcategoryId } = selection;
  if (!categoryId)
    return subcategoryId ? 'Choose a category before selecting a subcategory.' : null;
  const { data: category, error } = await supabase
    .from('ticket_categories')
    .select('id, is_active')
    .eq('organization_id', organizationId)
    .eq('id', categoryId)
    .maybeSingle();
  if (error) {
    reportServerError('ticket.references', error);
    return 'Categories could not be verified. Your entries are preserved; please try again.';
  }
  if (!category || (!category.is_active && categoryId !== previous?.categoryId))
    return 'Choose an available category.';
  if (subcategoryId) {
    const { data: subcategory, error: subcategoryError } = await supabase
      .from('ticket_subcategories')
      .select('id, is_active')
      .eq('organization_id', organizationId)
      .eq('category_id', categoryId)
      .eq('id', subcategoryId)
      .maybeSingle();
    if (subcategoryError) {
      reportServerError('ticket.references', subcategoryError);
      return 'Subcategories could not be verified. Your entries are preserved; please try again.';
    }
    if (!subcategory || (!subcategory.is_active && subcategoryId !== previous?.subcategoryId))
      return 'Choose an available subcategory belonging to this category.';
  }
  return null;
}

export async function createTicket(formData: FormData) {
  const viewer = await requireViewer();
  const input = parseTicketInput(formData, viewer);
  if (!input.data) return { error: input.error };
  const supabase = await createClient();
  if (formData.has('lookupLoadError'))
    return {
      error: 'Choices could not load. Your entries are preserved; retry the lookup before saving.',
    };
  if (formData.has('categoryLoadError'))
    return { error: 'Categories could not be loaded. Refresh the page and try again.' };
  const classification = {
    categoryId: optional(formData.get('categoryId')),
    subcategoryId: viewer.role === 'end_user' ? null : optional(formData.get('subcategoryId')),
  };
  const categoryError = await classificationError(supabase, viewer.organizationId, classification);
  if (categoryError) return { error: categoryError };
  return submitNewTicket(supabase, viewer, input.data, formData, classification);
}

export async function updateTicket(
  formData: FormData,
): Promise<{ error?: string; success?: string; revision?: number; conflict?: boolean }> {
  const viewer = await requireViewer();
  const ticketId = formString(formData, 'ticketId', '');
  if (viewer.role === 'end_user')
    return { error: 'Only ticket workers can update ticket details.' };
  const revision = Number(formData.get('revision'));
  if (!Number.isSafeInteger(revision) || revision < 1)
    return { error: 'Reload the latest ticket details before saving. Your draft is preserved.' };
  const dueAt = parseDeadline(
    formString(formData, 'dueAt', ''),
    formString(formData, 'dueTimezone', viewer.timeZone),
    formString(formData, 'dueOccurrence', ''),
  );
  if (dueAt === undefined)
    return {
      error:
        'Enter a valid manual due date in the displayed timezone. If the clock repeats this time, choose its first or second occurrence.',
    };
  const status = formString(formData, 'status', '') as TicketStatus;
  const priority = formString(formData, 'priority', '') as TicketPriority;
  if (
    !ticketId ||
    !Object.hasOwn(ticketStatuses, status) ||
    !Object.hasOwn(ticketPriorities, priority)
  )
    return { error: 'Choose a valid status and priority.' };
  if (
    formData.has('lookupLoadError') ||
    ['assignedTechnicianId', 'teamId', 'locationId'].some((name) => !formData.has(name))
  )
    return {
      error: 'Choices could not load. Your entries are preserved; retry the lookup before saving.',
    };
  const supabase = await createClient();
  if (
    formData.has('categoryLoadError') ||
    !formData.has('categoryId') ||
    !formData.has('subcategoryId')
  )
    return { error: 'Categories could not be loaded. Refresh the page and try again.' };
  const { data: currentTicket, error: currentError } = await supabase
    .from('tickets')
    .select('category_id, subcategory_id, revision')
    .eq('organization_id', viewer.organizationId)
    .eq('id', ticketId)
    .maybeSingle();
  if (currentError) {
    reportServerError('ticket.load', currentError);
    return { error: 'The ticket could not load. Your entries are preserved; please try again.' };
  }
  if (!currentTicket) return { error: 'The ticket could not be loaded. Refresh and try again.' };
  const conflict = {
    conflict: true,
    error:
      'This ticket changed while you were editing. Your draft is preserved. Review the latest details before saving again.',
  };
  if (currentTicket.revision !== revision) return conflict;
  const classification = {
    categoryId: optional(formData.get('categoryId')),
    subcategoryId: optional(formData.get('subcategoryId')),
  };
  const categoryError = await classificationError(supabase, viewer.organizationId, classification, {
    categoryId: currentTicket.category_id,
    subcategoryId: currentTicket.subcategory_id,
  });
  if (categoryError) return { error: categoryError };
  const assignee = optional(formData.get('assignedTechnicianId'));
  if (assignee) {
    const { data: worker, error: workerError } = await supabase
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', viewer.organizationId)
      .eq('user_id', assignee)
      .eq('status', 'active')
      .in('role', ['technician', 'administrator'])
      .maybeSingle();
    if (workerError) {
      reportServerError('ticket.references', workerError);
      return {
        error:
          'The technician could not be verified. Your entries are preserved; please try again.',
      };
    }
    if (!worker) return { error: 'Choose an active technician.' };
  }
  const { data, error } = await supabase
    .from('tickets')
    .update({
      status,
      priority,
      assigned_technician_id: assignee,
      team_id: optional(formData.get('teamId')),
      category_id: classification.categoryId,
      subcategory_id: classification.subcategoryId,
      location_id: optional(formData.get('locationId')),
      due_at: dueAt,
    })
    .eq('organization_id', viewer.organizationId)
    .eq('id', ticketId)
    .eq('revision', revision)
    .select('id, revision')
    .maybeSingle();
  if (!error && !data) return conflict;
  if (error || !data) {
    const reference = reportServerError('ticket.save', error);
    return {
      error: `The ticket could not be updated. Your entries are preserved. Reference: ${reference}`,
    };
  }
  revalidatePath(`/app/tickets/${ticketId}`);
  revalidatePath('/app/tickets');
  return { success: 'Ticket updated.', revision: data.revision };
}

/** Focused staff actions change only ownership/status, never hidden metadata. */
export async function workTicket(
  formData: FormData,
): Promise<{ error?: string; success?: string; conflict?: boolean; revision?: number }> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can work tickets.' };
  const ticketId = formString(formData, 'ticketId', '');
  const revision = Number(formData.get('revision'));
  const intent = formString(formData, 'intent', '');
  const status = formString(formData, 'status', '') as TicketStatus;
  if (
    !isUuid(ticketId) ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !['take', 'start', 'status'].includes(intent) ||
    (intent === 'status' && !Object.hasOwn(ticketStatuses, status))
  )
    return { error: 'Choose a valid action and reload the latest ticket.' };
  const db = await createClient();
  const changes =
    intent === 'take'
      ? { assigned_technician_id: viewer.id }
      : { status: intent === 'start' ? ('in_progress' as TicketStatus) : status };
  let query = db
    .from('tickets')
    .update(changes)
    .eq('organization_id', viewer.organizationId)
    .eq('id', ticketId)
    .eq('revision', revision);
  // Taking an unassigned ticket never replaces another person's ownership.
  if (intent === 'take')
    query = query.is('assigned_technician_id', null).not('status', 'in', '(resolved,closed)');
  if (intent === 'start') query = query.in('status', ['new', 'open', 'on_hold', 'waiting_on_user']);
  const { data, error } = await query.select('id, revision').maybeSingle();
  if (error) {
    reportServerError('ticket.save', error);
    return { error: 'The ticket could not be updated. Try again.' };
  }
  if (!data)
    return {
      conflict: true,
      error: 'This ticket changed. Review the refreshed ticket before trying again.',
    };
  revalidatePath(`/app/tickets/${ticketId}`);
  revalidatePath('/app/tickets');
  return {
    revision: data.revision,
    success:
      intent === 'take'
        ? 'Ticket assigned to you.'
        : intent === 'start'
          ? 'Work started.'
          : `Status updated to ${ticketStatuses[status].label}.`,
  };
}

export async function addTicketMessage(formData: FormData) {
  const viewer = await requireViewer();
  const ticketId = formString(formData, 'ticketId', '');
  const body = formString(formData, 'body', '').trim();
  const kind = formString(formData, 'kind', 'reply') as TicketMessageKind;
  const messageId = formString(formData, 'messageId', '');
  if (
    !isUuid(ticketId) ||
    !isUuid(messageId) ||
    !body ||
    body.length > 20000 ||
    !['reply', 'internal_note'].includes(kind) ||
    (kind === 'internal_note' && viewer.role === 'end_user')
  )
    return { error: 'Enter a message you are permitted to send (up to 20,000 characters).' };
  const supabase = await createClient();
  const { error } = await supabase.from('ticket_messages').insert({
    id: messageId,
    organization_id: viewer.organizationId,
    ticket_id: ticketId,
    author_id: viewer.id,
    body,
    kind,
  });
  if (error) {
    // A retry after a lost response must not post the same message twice.
    const { data: existing } = await supabase
      .from('ticket_messages')
      .select('id, body, kind, author_id, ticket_id')
      .eq('id', messageId)
      .eq('organization_id', viewer.organizationId)
      .maybeSingle();
    if (
      !existing ||
      existing.body !== body ||
      existing.kind !== kind ||
      existing.author_id !== viewer.id ||
      existing.ticket_id !== ticketId
    )
      return {
        error: 'The message could not be added. Your draft is preserved; please try again.',
      };
  }
  revalidatePath(`/app/tickets/${ticketId}`);
  revalidatePath('/app/tickets');
  return {
    success:
      kind === 'internal_note'
        ? 'Internal note added · IT staff only.'
        : viewer.role === 'end_user'
          ? 'Message sent to IT.'
          : 'Public reply sent.',
  };
}

export async function reopenTicket(
  formData: FormData,
): Promise<import('@/lib/action-result').ActionResult> {
  await requireViewer();
  const ticketId = formString(formData, 'ticketId', '');
  const reason = formString(formData, 'reason', '').trim();
  const revision = Number(formData.get('revision'));
  const token = formString(formData, 'requestToken', '');
  if (!reason || reason.length > 2000)
    return {
      error: 'Explain what is still wrong (up to 2,000 characters).',
      fieldErrors: { reason: 'Enter a reason for reopening.' },
    };
  if (!isUuid(ticketId) || !isUuid(token) || !Number.isSafeInteger(revision) || revision < 1)
    return {
      error: 'Refresh this ticket before trying to reopen it. Your explanation is preserved.',
    };
  const db = await createClient();
  const { error } = await db.rpc('reopen_ticket', {
    target: ticketId,
    expected_revision: revision,
    explanation: reason,
    token,
  });
  if (error) {
    if (error.code === 'PT409')
      return {
        error:
          'This ticket changed. Review its current status before reopening. Your explanation is preserved.',
      };
    reportServerError('ticket.reopen', error);
    return {
      error: 'The ticket could not be reopened. Your explanation is preserved; please try again.',
    };
  }
  const path = `/app/tickets/${ticketId}`;
  revalidatePath(path);
  revalidatePath('/app/tickets');
  revalidatePath('/app');
  revalidatePath('/app/notifications');
  return {
    redirectTo: `${path}?success=${encodeURIComponent('Ticket reopened. IT has been notified.')}`,
  };
}

export async function bulkUpdateTickets(formData: FormData) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') fail('/app/tickets', 'You cannot update these tickets.');
  const ids = [...new Set(formData.getAll('ticketIds').map(String))];
  const intent = formString(formData, 'intent', '');
  const value = formString(formData, intent, '');
  if (!ids.length || ids.length > 100 || ids.some((id) => !isUuid(id)))
    fail('/app/tickets', 'Select up to 100 tickets.');
  const supabase = await createClient();
  let changes: {
    status?: TicketStatus;
    priority?: TicketPriority;
    assigned_technician_id?: string | null;
  } = {};
  if (intent === 'status' && Object.hasOwn(ticketStatuses, value))
    changes = { status: value as TicketStatus };
  else if (intent === 'priority' && Object.hasOwn(ticketPriorities, value))
    changes = { priority: value as TicketPriority };
  else if (intent === 'assignee') {
    if (formData.has('lookupLoadError'))
      fail('/app/tickets', 'Choices could not load. Retry the technician lookup before assigning.');
    if (value) {
      const { data: worker } = await supabase
        .from('organization_memberships')
        .select('user_id')
        .eq('organization_id', viewer.organizationId)
        .eq('user_id', value)
        .eq('status', 'active')
        .in('role', ['technician', 'administrator'])
        .maybeSingle();
      if (!worker) fail('/app/tickets', 'Choose an active technician.');
    }
    changes = { assigned_technician_id: value || null };
  } else fail('/app/tickets', 'Choose a valid bulk action.');
  const { data, error } = await supabase
    .from('tickets')
    .update(changes)
    .eq('organization_id', viewer.organizationId)
    .in('id', ids)
    .select('id');
  if (error || !data || data.length !== ids.length)
    fail('/app/tickets', 'Some tickets could not be updated. Refresh the queue and try again.');
  const count = data?.length ?? 0;
  revalidatePath('/app/tickets');
  revalidatePath('/app');
  redirect(
    `/app/tickets?success=${encodeURIComponent(`${count} ticket${count === 1 ? '' : 's'} updated.`)}`,
  );
}

export async function saveIncident(
  formData: FormData,
): Promise<{ error?: string; success?: string; revision?: number; conflict?: boolean }> {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can coordinate incidents.' };
  const target = formString(formData, 'ticketId', ''),
    revision = Number(formData.get('revision'));
  if (!isUuid(target) || !Number.isSafeInteger(revision) || revision < 1)
    return { error: 'Reload the latest ticket before saving. Your draft is preserved.' };
  if (formData.has('lookupLoadError'))
    return { error: 'The incident owner could not load. Retry the lookup before saving.' };
  const input = parseIncident(formData);
  if ('error' in input) return { error: input.error };
  const db = await createClient();
  const { data, error } = await db.rpc('save_ticket_incident', {
    org: viewer.organizationId,
    target,
    expected_revision: revision,
    payload: input.data,
  });
  if (error?.code === 'PT409')
    return {
      conflict: true,
      error:
        'This ticket changed while you were editing. Your draft is preserved. Review the saved details and reload before saving.',
    };
  if (error || data === null) {
    reportServerError('incident.save', error);
    return {
      error:
        'Incident details could not be saved. Check that the owner is active and try again. Your draft is preserved.',
    };
  }
  revalidatePath(`/app/tickets/${target}`);
  revalidatePath('/app/tickets');
  return { success: 'Incident details saved.', revision: data };
}
