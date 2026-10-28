/** One presentation and validation path for employee resolution ratings. */
export const ratingScores = [
  { score: 1, label: 'Very dissatisfied' },
  { score: 2, label: 'Dissatisfied' },
  { score: 3, label: 'Neutral' },
  { score: 4, label: 'Satisfied' },
  { score: 5, label: 'Very satisfied' },
] as const;
export type RatingScore = (typeof ratingScores)[number]['score'];

export const RATING_COMMENT_LIMIT = 1000;
/** Mirrors private.rate_ticket_resolution; the database enforces it independently. */
export const RATING_WINDOW_DAYS = 30;

export function ratingLabel(score: number) {
  return ratingScores.find((item) => item.score === score)?.label ?? 'Unknown rating';
}

/** "Satisfied · 4 of 5": always written, never conveyed by color or icons alone. */
export function describeRating(score: number) {
  return `${ratingLabel(score)} · ${score} of 5`;
}

export function ratingWindowOpen(resolvedAt: string | null, now: number) {
  const resolved = resolvedAt ? Date.parse(resolvedAt) : NaN;
  return Number.isFinite(resolved) && now - resolved < RATING_WINDOW_DAYS * 86_400_000;
}

export function parseRating(
  form: FormData,
):
  | { ok: true; ticketId: string; score: RatingScore; comment: string | null }
  | { ok: false; field: 'score' | 'comment' | 'ticketId'; message: string } {
  const ticketId = String(form.get('ticketId') ?? '');
  const score = Number(form.get('score'));
  const comment = String(form.get('comment') ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ticketId))
    return { ok: false, field: 'ticketId', message: 'Refresh this request before rating it.' };
  if (!ratingScores.some((item) => item.score === score))
    return { ok: false, field: 'score', message: 'Choose how satisfied you are.' };
  if (comment.length > RATING_COMMENT_LIMIT)
    return {
      ok: false,
      field: 'comment',
      message: `Keep your comment to ${RATING_COMMENT_LIMIT.toLocaleString('en')} characters.`,
    };
  return { ok: true, ticketId, score: score as RatingScore, comment: comment || null };
}

export type SatisfactionSummary = {
  days: number;
  responses: number;
  average: number | null;
  satisfied: number;
  distribution: { score: number; count: number }[];
  comments: {
    score: number;
    comment: string;
    updated_at: string;
    ticket_id: string;
    ticket_number: number;
    title: string;
  }[];
};

export function isSatisfactionSummary(value: unknown): value is SatisfactionSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const count = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  return (
    count(v.days) &&
    count(v.responses) &&
    count(v.satisfied) &&
    (v.average === null || count(Number(v.average))) &&
    Array.isArray(v.distribution) &&
    v.distribution.every(
      (row) => row && typeof row === 'object' && count(row.score) && count(row.count),
    ) &&
    Array.isArray(v.comments) &&
    v.comments.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        count(row.score) &&
        typeof row.comment === 'string' &&
        typeof row.updated_at === 'string' &&
        typeof row.ticket_id === 'string' &&
        count(row.ticket_number) &&
        typeof row.title === 'string',
    )
  );
}

/** Share of ratings that were 4 or 5, as a whole percentage; null without responses. */
export function satisfiedPercent(summary: Pick<SatisfactionSummary, 'responses' | 'satisfied'>) {
  return summary.responses ? Math.round((summary.satisfied / summary.responses) * 100) : null;
}
