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
  if (
    !Object.hasOwn(holdReasons, reason) ||
    !note ||
    note.length > 2000 ||
    !review ||
    Date.parse(review) <= now
  )
    return {
      error:
        'Choose a hold reason, enter an explanation up to 2,000 characters and set a future follow-up date.',
    };
  return { values: { hold_reason: reason, hold_note: note, hold_review_at: review } };
}
