'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { confirmDiscardChanges } from '@/components/ui/unsaved-changes';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { useTimezone } from '@/features/timezones/provider';

import { changeStep } from './checklist-actions';
import { DeadlineField } from './deadline-field';
import type { IncidentStep } from './response-checklist';

export function ChecklistEditor({
  ticketId,
  stepId,
  assigneeId,
  step,
}: {
  ticketId: string;
  stepId: string;
  assigneeId: string;
  step?: IncidentStep;
}) {
  const id = useId(),
    zone = useTimezone(),
    router = useRouter();
  const [draft] = useState(step);
  const [currentStepId, setCurrentStepId] = useState(stepId);
  const [revision, setRevision] = useState(step?.revision ?? 0);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <ActionForm
      className="stack"
      action={async (form) => {
        const result = await changeStep(form);
        setFailed(Boolean(result.error));
        if (result.success) {
          setRevision(result.revision!);
          if (!draft) setSaved(true);
          router.refresh();
        }
        return result;
      }}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="stepId" value={currentStepId} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="operation" value={draft ? 'edit' : 'add'} />
      {saved ? (
        <div className="stack">
          <p>Step added to the checklist.</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setCurrentStepId(crypto.randomUUID());
              setRevision(0);
              setSaved(false);
            }}
          >
            Add another step
          </button>
        </div>
      ) : (
        <>
          <label className="field" htmlFor={`${id}-title`}>
            Step title *
            <input
              id={`${id}-title`}
              className="input"
              name="title"
              required
              minLength={3}
              maxLength={180}
              defaultValue={draft?.title ?? ''}
            />
          </label>
          <label className="field" htmlFor={`${id}-instructions`}>
            Instructions
            <textarea
              id={`${id}-instructions`}
              className="input"
              name="instructions"
              rows={3}
              maxLength={4000}
              defaultValue={draft?.instructions ?? ''}
            />
          </label>
          <LookupSelect
            searchable="when-paginated"
            resource="technicians"
            name="assigneeId"
            label="Assigned to"
            defaultValue={draft?.assignee_id ?? assigneeId}
            required
          />
          <DeadlineField
            timeZone={zone}
            value={draft?.due_at}
            label="Step deadline"
            hint="Optional. Applies to this response step only."
          />
          <SubmitButton className="button button-primary" pendingLabel="Saving step…">
            {draft ? 'Save step' : 'Add step'}
          </SubmitButton>
        </>
      )}
      {failed && (
        <>
          <a
            className="button button-secondary"
            href={`/app/tickets/${ticketId}#response-checklist`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Review latest checklist (opens in a new tab)
          </a>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              if (confirmDiscardChanges(true)) window.location.reload();
            }}
          >
            Reload latest checklist
          </button>
        </>
      )}
    </ActionForm>
  );
}
export function ChecklistStepAction({
  ticketId,
  step,
  operation,
  label,
}: {
  ticketId: string;
  step: IncidentStep;
  operation: 'acknowledge' | 'complete' | 'reopen';
  label: string;
}) {
  const router = useRouter();
  return (
    <ActionForm
      protectDraft={false}
      action={async (form) => {
        const result = await changeStep(form);
        if (result.success) router.refresh();
        return result;
      }}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="stepId" value={step.id} />
      <input type="hidden" name="revision" value={step.revision} />
      <input type="hidden" name="operation" value={operation} />
      <SubmitButton className="button button-secondary" pendingLabel="Saving…" aria-label={label}>
        {operation === 'acknowledge'
          ? 'Acknowledge step'
          : operation === 'complete'
            ? 'Complete step'
            : 'Reopen step'}
      </SubmitButton>
    </ActionForm>
  );
}
