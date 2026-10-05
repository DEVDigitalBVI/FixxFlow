"use client";
import { useEffect, useRef } from "react";

export function BulkSelectAll({ formId }: { formId: string }) {
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = document.getElementById(formId);
    const refresh = () => {
      const rows = Array.from(form?.querySelectorAll<HTMLInputElement>('input[name="ticketIds"]') ?? []);
      const selected = rows.filter(row => row.checked).length;
      if (selectAll.current) { selectAll.current.checked = !!rows.length && selected === rows.length; selectAll.current.indeterminate = selected > 0 && selected < rows.length; }
    };
    form?.addEventListener('change', refresh);
    return () => form?.removeEventListener('change', refresh);
  }, [formId]);
  return <input ref={selectAll} type="checkbox" aria-label="Select all displayed tickets" onChange={event => {
    const checked = event.currentTarget.checked;
    document.querySelectorAll<HTMLInputElement>(`#${formId} input[name="ticketIds"]`).forEach(input => { input.checked = checked; });
    document.getElementById(formId)?.dispatchEvent(new Event("change", { bubbles: true }));
  }}/>;
}
