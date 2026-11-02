'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

import { SESSION_WARNING_MS } from './session-controller';

export function SessionWarning({
  remaining,
  blocked = false,
  extending = false,
  onStay,
  onSignOut,
}: {
  remaining: number;
  blocked?: boolean;
  extending?: boolean;
  onStay: () => void;
  onSignOut: () => void;
}) {
  return (
    <Dialog
      open={!blocked && remaining > 0 && remaining <= SESSION_WARNING_MS}
      onOpenChange={(open) => {
        if (!open) onStay();
      }}
    >
      <DialogContent
        aria-describedby="session-warning-description"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogTitle>You’re about to be signed out</DialogTitle>
        <p id="session-warning-description" className="mt-3 text-(color:--color-text-muted)">
          Your session ends after 30 minutes without activity. Save your work or stay signed in to
          continue. Unsaved changes will be lost when your session ends.
        </p>
        <p className="mt-3" role="timer" aria-live="off">
          Time remaining: {Math.floor(remaining / 60000)}:
          {String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={onSignOut}>
            Sign out
          </Button>
          <Button variant="primary" autoFocus disabled={extending} onClick={onStay}>
            {extending ? 'Keeping you signed in…' : 'Stay signed in'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
