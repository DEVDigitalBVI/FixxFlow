'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { ActionForm } from '@/components/ui/action-form';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
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
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setCurrentStepId(crypto.randomUUID());
              setRevision(0);
              setSaved(false);
            }}
          >
            Add another step
          </Button>
        </div>
      ) : (
        <>
          <label className="field" htmlFor={`${id}-title`}>
            Step title *
            <Input
              id={`${id}-title`}
              name="title"
              required
              minLength={3}
              maxLength={180}
              defaultValue={draft?.title ?? ''}
            />
          </label>
          <label className="field" htmlFor={`${id}-instructions`}>
            Instructions
            <Textarea
              id={`${id}-instructions`}
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
          <SubmitButton variant="primary" pendingLabel="Saving step…">
            {draft ? 'Save step' : 'Add step'}
          </SubmitButton>
        </>
      )}
      {failed && (
        <>
          <a
            className={buttonVariants({ variant: 'secondary' })}
            href={`/app/tickets/${ticketId}#response-checklist`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Review latest checklist (opens in a new tab)
          </a>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (confirmDiscardChanges(true)) window.location.reload();
            }}
          >
            Reload latest checklist
          </Button>
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
      <SubmitButton variant="secondary" pendingLabel="Saving…" aria-label={label}>
        {operation === 'acknowledge'
          ? 'Acknowledge step'
          : operation === 'complete'
            ? 'Complete step'
            : 'Reopen step'}
      </SubmitButton>
    </ActionForm>
  );
}
