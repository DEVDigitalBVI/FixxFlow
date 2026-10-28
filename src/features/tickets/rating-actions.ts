'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { requireViewer } from '@/lib/auth/viewer';
import { reportServerError } from '@/lib/server-errors';
import { createClient } from '@/lib/supabase/server';

import { parseRating, ratingLabel } from './ratings';

export async function rateResolution(form: FormData): Promise<ActionResult> {
  await requireViewer();
  const input = parseRating(form);
  if (!input.ok)
    return {
      error: `${input.message} Your rating is preserved.`,
      ...(input.field === 'ticketId' ? {} : { fieldErrors: { [input.field]: input.message } }),
    };
  const db = await createClient();
  const { error } = await db.rpc('rate_ticket_resolution', {
    target: input.ticketId,
    rating: input.score,
    remark: input.comment,
  });
  if (error) {
    if (error.code === 'PT409')
      return {
        error:
          'This request is no longer resolved, so it can’t be rated right now. Refresh to see its current status.',
      };
    if (error.code === 'PT410')
      return { error: 'Ratings close 30 days after a request is resolved.' };
    if (error.code === '42501')
      return { error: 'Only the person who opened this request can rate it.' };
    reportServerError('ticket.rating', error);
    return { error: 'Your rating could not be sent. It is preserved; please try again.' };
  }
  revalidatePath(`/app/tickets/${input.ticketId}`);
  revalidatePath('/app/reports');
  return { success: `Thanks — you rated this resolution “${ratingLabel(input.score)}”.` };
}
