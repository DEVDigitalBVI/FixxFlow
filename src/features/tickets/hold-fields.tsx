'use client';

import { useId } from 'react';

import { NativeSelect, Textarea } from '@/components/ui/input';

import { DeadlineField } from './deadline-field';
import { holdReasons, type HoldFields as HoldValues } from './holds';

export function HoldFields({ ticket, timeZone }: { ticket: HoldValues; timeZone: string }) {
  const hint = useId();
  return (
    <fieldset className="stack ticket-hold-fields">
      <legend>Hold &amp; follow-up</legend>
      <p id={hint} className="muted">
        Resolution time pauses. An owner is required. This explanation is visible to the requester;
        keep private troubleshooting in internal notes.
      </p>
      <label>
        Hold reason
        <NativeSelect name="holdReason" required defaultValue={ticket.hold_reason ?? ''}>
          <option value="">Choose a reason</option>
          {Object.entries(holdReasons).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label>
        Explanation
        <Textarea
          name="holdNote"
          required
          maxLength={2000}
          defaultValue={ticket.hold_note ?? ''}
          aria-describedby={hint}
        />
      </label>
      <DeadlineField
        name="holdReview"
        label="Next follow-up"
        timeZone={timeZone}
        value={ticket.hold_review_at}
        required
        hint="Review this hold by this time. This does not extend the SLA or automatically resume work."
      />
    </fieldset>
  );
}
