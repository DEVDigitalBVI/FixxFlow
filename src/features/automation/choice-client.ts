import type { Choice } from './ui-model';

/** GET reads can run in parallel; Server Actions serialize browser requests. */
export async function loadAutomationChoices(resource: string, query: string, page: number, selected: string[], signal: AbortSignal): Promise<{ rows: Choice[]; hasNext: boolean }> {
  const params = new URLSearchParams({ resource, q: query, page: String(page) });
  selected.forEach(id => params.append('selected',id));
  const response = await fetch(`/app/administration/automations/choices?${params}`, {
    signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) throw new Error('Choices could not load. Try again.');
  return response.json();
}
