'use client';

import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';

import { runAnalyticsCleanup } from './retention-actions';

export function CleanupForm() {
  return (
    <ActionForm
      action={runAnalyticsCleanup}
      protectDraft={false}
      className="stack analytics-cleanup-form"
    >
      <p className="muted">
        Run the same cleanup now. Only expired analytics records are removed; customer tickets,
        messages and equipment are unchanged.
      </p>
      <SubmitButton className="button button-secondary" pendingLabel="Running cleanup…">
        Run cleanup now
      </SubmitButton>
    </ActionForm>
  );
}
