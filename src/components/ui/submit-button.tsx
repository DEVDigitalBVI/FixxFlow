'use client';

import { useFormStatus } from 'react-dom';
import { useContext, type ComponentProps } from 'react';
import { FormPendingContext } from './form-pending';

export function SubmitButton({ children, pendingLabel = 'Saving…', disabled, ...props }: ComponentProps<'button'> & { pendingLabel?: string }) {
  const status = useFormStatus();
  const actionPending = useContext(FormPendingContext);
  const pending = status.pending || actionPending;
  return <button {...props} type="submit" disabled={disabled || pending} aria-busy={pending}>{pending ? pendingLabel : children}</button>;
}
