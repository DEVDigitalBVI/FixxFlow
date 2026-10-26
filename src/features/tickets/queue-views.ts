/** Queue URL parameters that describe a view. Shared by paging, filter chips and saved views. */
export const QUEUE_VIEW_KEYS = [
  'q',
  'kind',
  'type',
  'view',
  'team',
  'status',
  'priority',
  'sort',
  'overdue',
  'sla',
  'tag',
] as const;
export type QueueViewKey = (typeof QUEUE_VIEW_KEYS)[number];

export const SAVED_VIEW_LIMIT = 20;
export const SAVED_VIEW_NAME_LENGTH = 60;

/**
 * Keeps only known view parameters, in a stable order, with bounded values.
 * Paging, the selected ticket and flash messages are never part of a saved view.
 */
export function queueViewQuery(
  input: Partial<Record<string, string | undefined>> | URLSearchParams,
): string {
  const read = (key: string) =>
    input instanceof URLSearchParams ? (input.get(key) ?? undefined) : input[key];
  const params = new URLSearchParams();
  for (const key of QUEUE_VIEW_KEYS) {
    const value = read(key)?.trim();
    if (value && value.length <= 200 && !/[\u0000-\u001f]/.test(value)) params.set(key, value);
  }
  return params.toString();
}
