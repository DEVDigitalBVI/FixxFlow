'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { saveIncident } from '@/app/app/tickets/actions';
import { ActionForm } from '@/components/ui/action-form';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { SubmitButton } from '@/components/ui/submit-button';
import { confirmDiscardChanges } from '@/components/ui/unsaved-changes';

import { IncidentFields } from './incident-fields';
import type { Incident } from './incidents';

export function IncidentEditor({
  ticketId,
  ticketRevision,
  incident,
  ownerId,
}: {
  ticketId: string;
  ticketRevision: number;
  incident: Incident | null;
  ownerId: string;
}) {
  const [draft] = useState(incident);
  const [revision, setRevision] = useState(ticketRevision);
  const [conflicted, setConflicted] = useState(false);
  const router = useRouter();
  return (
    <ActionForm
      className="stack"
      action={async (data) => {
        const result = await saveIncident(data);
        if (result.revision !== undefined) {
          setRevision(result.revision);
          setConflicted(false);
          router.refresh();
        } else if (result.conflict) {
          setConflicted(true);
          router.refresh();
        }
        return result;
      }}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="revision" value={revision} />
      {(conflicted || ticketRevision !== revision) && (
        <Alert role="status">
          <p>This ticket has changed. Your incident draft is preserved.</p>
          <a
            className={buttonVariants({ variant: 'secondary' })}
            href={`/app/tickets/${ticketId}#incident-summary`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Review saved incident (opens in a new tab)
          </a>
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              if (confirmDiscardChanges(true)) window.location.reload();
            }}
          >
            Reload latest details
          </Button>
        </Alert>
      )}
      <IncidentFields incident={draft} ownerId={ownerId} />
      <SubmitButton variant="primary" pendingLabel="Saving incident…">
        {draft ? 'Save incident details' : 'Declare incident'}
      </SubmitButton>
    </ActionForm>
  );
}
