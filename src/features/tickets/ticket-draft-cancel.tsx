'use client';

import Link from 'next/link';
import { useContext, type MouseEvent } from 'react';

import { FormPendingContext } from '@/components/ui/form-pending';
import { confirmDiscardChanges } from '@/components/ui/unsaved-changes';

/** Keep navigation native; confirm only when abandoning written request content. */
export function TicketDraftCancel({ href }: { href: string }) {
  const pending = useContext(FormPendingContext);
  function cancel(event: MouseEvent<HTMLAnchorElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    const form = event.currentTarget.closest('form');
    const hasDraft = ['title', 'description'].some((name) =>
      form?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value.trim(),
    );
    if (hasDraft && !confirmDiscardChanges(Boolean(hasDraft))) {
      event.preventDefault();
      event.currentTarget.focus();
    }
  }
  return (
    <Link
      className="button button-secondary"
      href={href}
      onClick={cancel}
      aria-disabled={pending || undefined}
    >
      Cancel
    </Link>
  );
}
