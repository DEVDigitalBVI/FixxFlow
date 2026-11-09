import { parseDeadline } from './deadlines';

export const holdReasons = {
  vendor: 'Waiting for vendor',
  parts: 'Waiting for parts',
  approval: 'Waiting for approval',
  scheduled_work: 'Scheduled work',
} as const;
export type HoldFields = {
  hold_reason?: string | null;
  hold_note?: string | null;
  hold_review_at?: string | null;
};

export function parseHold(data: FormData, now = Date.now()) {
  const reason = String(data.get('holdReason') ?? '');
  const note = String(data.get('holdNote') ?? '').trim();
  const review = parseDeadline(
    String(data.get('holdReviewAt') ?? ''),
    String(data.get('holdReviewTimezone') ?? ''),
    String(data.get('holdReviewOccurrence') ?? ''),
  );
  if (!Object.hasOwn(holdReasons, reason)) return { error: 'Choose a hold reason.' };
  if (!note) return { error: 'Enter an explanation for this hold.' };
  if (note.length > 2000)
    return { error: 'Keep the hold explanation to 2,000 characters or fewer.' };
  if (!String(data.get('holdReviewAt') ?? '').trim())
    return { error: 'Enter the next follow-up date and time.' };
  if (!review)
    return {
      error:
        'Enter a valid next follow-up date and time. If this time occurs twice, choose its first or second occurrence.',
    };
  if (Date.parse(review) <= now)
    return { error: 'The next follow-up must be in the future. Choose a later date and time.' };
  return { values: { hold_reason: reason, hold_note: note, hold_review_at: review } };
}
