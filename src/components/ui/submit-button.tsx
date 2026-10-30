'use client';

import { useContext, type ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';

import { FormPendingContext } from './form-pending';
import { FormProgressContext } from './form-progress';

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  disabled,
  ...props
}: ComponentProps<'button'> & { pendingLabel?: string }) {
  const status = useFormStatus();
  const actionPending = useContext(FormPendingContext);
  const pending = status.pending || actionPending;
  const progress = useContext(FormProgressContext);
  return (
    <button {...props} type="submit" disabled={disabled || pending} aria-busy={pending}>
      {pending ? (progress ?? pendingLabel) : children}
    </button>
  );
}
