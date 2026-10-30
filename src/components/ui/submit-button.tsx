'use client';

import { useContext } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, type ButtonProps } from './button';
import { FormPendingContext } from './form-pending';
import { FormProgressContext } from './form-progress';

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  disabled,
  ...props
}: Omit<ButtonProps, 'asChild'> & { pendingLabel?: string }) {
  const status = useFormStatus();
  const actionPending = useContext(FormPendingContext);
  const pending = status.pending || actionPending;
  const progress = useContext(FormProgressContext);
  return (
    <Button {...props} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? (progress ?? pendingLabel) : children}
    </Button>
  );
}
