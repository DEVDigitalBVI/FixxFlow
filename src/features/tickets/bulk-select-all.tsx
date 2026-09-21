"use client";

export function BulkSelectAll({ formId }: { formId: string }) {
  return <input type="checkbox" aria-label="Select all displayed tickets" onChange={event => {
    document.querySelectorAll<HTMLInputElement>(`#${formId} input[name="ticketIds"]`).forEach(input => { input.checked = event.currentTarget.checked; });
  }}/>;
}
