'use client';

import { useEffect, useState, type ReactNode } from 'react';

export function BulkActions({ formId, children }: { formId: string; children: ReactNode }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const form = document.getElementById(formId);
    const refresh = () => setCount(form?.querySelectorAll('input[name="ticketIds"]:checked').length ?? 0);
    refresh();
    form?.addEventListener('change', refresh);
    return () => form?.removeEventListener('change', refresh);
  }, [formId]);
  return <section className="bulk-selection" hidden={!count} aria-label="Selected ticket actions">
    <div className="bulk-selection-summary"><strong role="status">{count} {count === 1 ? 'ticket' : 'tickets'} selected</strong><button className="button button-quiet" type="button" onClick={() => {
      const form = document.getElementById(formId);
      form?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => { input.checked = false; input.indeterminate = false; });
      setCount(0);
      form?.querySelector<HTMLInputElement>('input[name="ticketIds"]')?.focus();
    }}>Clear selection</button></div>{children}
  </section>;
}
