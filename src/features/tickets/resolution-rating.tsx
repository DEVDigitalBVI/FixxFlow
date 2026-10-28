'use client';

import { useId, useState } from 'react';

import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import type { ActionResult } from '@/lib/action-result';

import { describeRating, RATING_COMMENT_LIMIT, ratingScores } from './ratings';

type Rating = { score: number; comment: string | null };

export function ResolutionRating({
  ticketId,
  rating,
  canRate,
  action,
}: {
  ticketId: string;
  rating: Rating | null;
  /** False once the 30-day rating window has closed. */
  canRate: boolean;
  action: (data: FormData) => Promise<ActionResult>;
}) {
  const id = useId();
  // Decided once per visit, so the form never jumps (and loses its feedback) after saving.
  const [startedRated] = useState(Boolean(rating));
  if (!rating && !canRate) return null;
  const form = (
    <ActionForm action={action} className="stack resolution-rating-form">
      <input type="hidden" name="ticketId" value={ticketId} />
      <fieldset className="rating-scale">
        <legend>How satisfied are you with how this was resolved?</legend>
        <div className="rating-options">
          {ratingScores.map((item) => (
            <label key={item.score} className="rating-option">
              <input
                type="radio"
                name="score"
                value={item.score}
                required
                defaultChecked={rating?.score === item.score}
              />
              <span>
                <strong>{item.score}</strong> {item.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor={`${id}-comment`}>
          Anything else IT should know? <span className="muted">Optional</span>
        </label>
        <textarea
          id={`${id}-comment`}
          name="comment"
          className="input"
          rows={3}
          maxLength={RATING_COMMENT_LIMIT}
          defaultValue={rating?.comment ?? ''}
          aria-describedby={`${id}-hint`}
        />
        <p id={`${id}-hint`} className="muted">
          IT staff can see your rating and comment. Up to 1,000 characters.
        </p>
      </div>
      <SubmitButton className="button button-primary" pendingLabel="Sending rating…">
        {rating ? 'Update rating' : 'Send rating'}
      </SubmitButton>
    </ActionForm>
  );
  return (
    <section className="portal-detail-card resolution-rating" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>How did IT do?</h2>
      {rating ? (
        <div className="resolution-rating-summary">
          <p>
            You rated this resolution <strong>{describeRating(rating.score)}</strong>.
          </p>
          {rating.comment && <p className="resolution-rating-comment">“{rating.comment}”</p>}
        </div>
      ) : (
        <p className="muted">Your feedback helps IT improve. It takes a few seconds.</p>
      )}
      {canRate &&
        (startedRated ? (
          <details className="resolution-rating-change">
            <summary>Change your rating</summary>
            {form}
          </details>
        ) : (
          form
        ))}
      {!canRate && <p className="muted">Ratings close 30 days after a request is resolved.</p>}
    </section>
  );
}
