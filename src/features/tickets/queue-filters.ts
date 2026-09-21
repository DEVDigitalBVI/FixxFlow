export const queueViews = ["mine", "unassigned", "team", "all"] as const;
export const queueSorts = ["updated", "oldest", "newest", "due", "priority"] as const;

export function normalizeQueueFilters(input: { view?: string; sort?: string; q?: string }) {
  const view = queueViews.find(value => value === input.view) ?? "all";
  const sort = queueSorts.find(value => value === input.sort) ?? "updated";
  const search = input.q?.trim().replace(/[%_,()]/g, "") ?? "";
  const ticketNumber = /^#?\d+$/.test(search) ? Number(search.replace("#", "")) : null;
  return { view, sort, search, ticketNumber: ticketNumber !== null && Number.isSafeInteger(ticketNumber) ? ticketNumber : null };
}
