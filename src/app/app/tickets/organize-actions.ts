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
