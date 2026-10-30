'use server';

import { revalidatePath } from 'next/cache';

import { normalizeTag, TICKET_TAG_LIMIT } from '@/features/tickets/tags';
import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { formString } from '@/lib/form-data';
import { isUuid } from '@/lib/ids';
import { createClient } from '@/lib/supabase/server';

/** Staff-only ticket organization: tags, related tickets and watchers. */
async function staffTicket(form: FormData) {
  const viewer = await requireViewer();
  if (viewer.role === 'end_user') return { error: 'Only IT staff can organize tickets.' } as const;
  const ticketId = formString(form, 'ticketId', '');
  if (!isUuid(ticketId)) return { error: 'Reload the ticket and try again.' } as const;
  return { viewer, ticketId, supabase: await createClient() } as const;
}

function refresh(ticketId: string) {
  revalidatePath(`/app/tickets/${ticketId}`);
  revalidatePath('/app/tickets');
}

export async function addTicketTag(form: FormData): Promise<ActionResult> {
  const context = await staffTicket(form);
  if ('error' in context) return { error: context.error };
  const { viewer, ticketId, supabase } = context;
  const tag = normalizeTag(formString(form, 'tag', ''));
  if (!tag)
    return {
      error:
        'Enter a tag of up to 40 characters using letters, numbers, spaces, dots, dashes or underscores.',
    };
  const { error } = await supabase.from('ticket_tags').insert({
    organization_id: viewer.organizationId,
    ticket_id: ticketId,
    tag,
    created_by: viewer.id,
  });
  if (error?.code === '23505') return { success: `“${tag}” is already on this ticket.` };
  if (error?.code === '23514')
    return { error: `A ticket can have up to ${TICKET_TAG_LIMIT} tags.` };
  if (error) return { error: 'The tag could not be added. Try again.' };
  refresh(ticketId);
  return { success: `Tag “${tag}” added.` };
}

export async function removeTicketTag(form: FormData): Promise<ActionResult> {
  const context = await staffTicket(form);
  if ('error' in context) return { error: context.error };
  const { viewer, ticketId, supabase } = context;
  const tag = normalizeTag(formString(form, 'tag', ''));
  if (!tag) return { error: 'Reload the ticket and try again.' };
  const { error } = await supabase
    .from('ticket_tags')
    .delete()
    .eq('organization_id', viewer.organizationId)
    .eq('ticket_id', ticketId)
    .eq('tag', tag);
  if (error) return { error: 'The tag could not be removed. Try again.' };
  refresh(ticketId);
  return { success: `Tag “${tag}” removed.` };
}

function ticketNumber(value: string): number | null {
  const match = value.trim().match(/^#?(\d{1,12})$/);
  const number = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Resolves a ticket number within the viewer's own workspace only. */
async function ticketByNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  number: number,
) {
  const { data, error } = await supabase
    .from('tickets')
    .select('id, ticket_number')
    .eq('organization_id', organizationId)
    .eq('ticket_number', number)
    .maybeSingle();
  return error ? { error: true as const } : { ticket: data };
}

export async function linkTicket(form: FormData): Promise<ActionResult> {
  const context = await staffTicket(form);
  if ('error' in context) return { error: context.error };
  const { viewer, ticketId, supabase } = context;
  const number = ticketNumber(formString(form, 'ticketNumber', ''));
  if (!number) return { error: 'Enter a ticket number, such as #1042.' };
  const found = await ticketByNumber(supabase, viewer.organizationId, number);
  if ('error' in found) return { error: 'Tickets could not be checked. Try again.' };
  if (!found.ticket) return { error: `Ticket #${number} was not found in this workspace.` };
  if (found.ticket.id === ticketId) return { error: 'A ticket cannot be linked to itself.' };
  const { error } = await supabase.from('ticket_links').insert({
    organization_id: viewer.organizationId,
    ticket_id: ticketId,
    linked_ticket_id: found.ticket.id,
    kind: 'related',
    created_by: viewer.id,
  });
  if (error?.code === '23505') return { success: `Ticket #${number} is already linked.` };
  if (error) return { error: 'The tickets could not be linked. Try again.' };
  refresh(ticketId);
  revalidatePath(`/app/tickets/${found.ticket.id}`);
  return { success: `Linked to ticket #${number}.` };
}

export async function unlinkTicket(form: FormData): Promise<ActionResult> {
  const context = await staffTicket(form);
  if ('error' in context) return { error: context.error };
  const { viewer, ticketId, supabase } = context;
  const linkedId = formString(form, 'linkedId', '');
  if (!isUuid(linkedId)) return { error: 'Reload the ticket and try again.' };
  const { error } = await supabase
    .from('ticket_links')
    .delete()
    .eq('organization_id', viewer.organizationId)
    .or(
      `and(ticket_id.eq.${ticketId},linked_ticket_id.eq.${linkedId}),and(ticket_id.eq.${linkedId},linked_ticket_id.eq.${ticketId})`,
    );
  if (error) return { error: 'The link could not be removed. Try again.' };
  refresh(ticketId);
  revalidatePath(`/app/tickets/${linkedId}`);
  return { success: 'Link removed.' };
}

export async function markTicketDuplicate(form: FormData): Promise<ActionResult> {
  const context = await staffTicket(form);
  if ('error' in context) return { error: context.error };
  const { viewer, ticketId, supabase } = context;
  const revision = Number(formString(form, 'revision', ''));
  const number = ticketNumber(formString(form, 'mainNumber', ''));
  const message = formString(form, 'message', '').trim();
  if (!Number.isSafeInteger(revision)) return { error: 'Reload the ticket and try again.' };
  if (!number) return { error: 'Enter the main ticket number, such as #1042.' };
  if (message.length > 20000)
    return { error: 'Keep the message to the requester under 20,000 characters.' };
  const found = await ticketByNumber(supabase, viewer.organizationId, number);
  if ('error' in found) return { error: 'Tickets could not be checked. Try again.' };
  if (!found.ticket) return { error: `Ticket #${number} was not found in this workspace.` };
  const { error } = await supabase.rpc('mark_ticket_duplicate', {
    org: viewer.organizationId,
    duplicate: ticketId,
    main: found.ticket.id,
    expected_revision: revision,
    requester_message: message || undefined,
  });
  if (error?.code === 'PT409')
    return { error: 'This ticket changed. Review the refreshed ticket before trying again.' };
  if (error?.code === '22023') return { error: `${error.message}.` };
  if (error) return { error: 'The ticket could not be closed as a duplicate. Try again.' };
  refresh(ticketId);
  revalidatePath(`/app/tickets/${found.ticket.id}`);
  return { success: `Closed as a duplicate of ticket #${number}.` };
}

export async function watchTicket(form: FormData): Promise<ActionResult> {
  const context = await staffTicket(form);
  if ('error' in context) return { error: context.error };
  const { viewer, ticketId, supabase } = context;
  const { error } = await supabase
    .from('ticket_watchers')
    .insert({ organization_id: viewer.organizationId, ticket_id: ticketId, user_id: viewer.id });
  if (error && error.code !== '23505')
    return { error: 'We couldn’t turn on ticket updates. Try again.' };
  refresh(ticketId);
  return {
    success:
      'You’re following this ticket. You’ll be notified of public replies, resolution and reopening.',
  };
}

/** Stops watching. Administrators may also remove another staff member's watch. */
export async function unwatchTicket(form: FormData): Promise<ActionResult> {
  const context = await staffTicket(form);
  if ('error' in context) return { error: context.error };
  const { viewer, ticketId, supabase } = context;
  const userId = formString(form, 'userId', viewer.id);
  if (!isUuid(userId)) return { error: 'Reload the ticket and try again.' };
  const { data, error } = await supabase
    .from('ticket_watchers')
    .delete()
    .eq('organization_id', viewer.organizationId)
    .eq('ticket_id', ticketId)
    .eq('user_id', userId)
    .select('user_id');
  if (error) return { error: 'We couldn’t stop these ticket updates. Try again.' };
  if (!data?.length && userId !== viewer.id)
    return { error: 'Only administrators can stop another person following a ticket.' };
  refresh(ticketId);
  return {
    success:
      userId === viewer.id ? 'You stopped following this ticket.' : 'Removed from ticket updates.',
  };
}
