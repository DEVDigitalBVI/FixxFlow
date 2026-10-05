export const HISTORY_PAGE_SIZE = 50;
export type HistoryRow = { id: string | number; created_at: string };

export function historyCursor(row: HistoryRow) {
  return `${row.created_at}|${row.id}`;
}

/** Validate both values before embedding them in PostgREST's filter grammar. */
export function historyFilter(value: string | string[] | undefined) {
  if (!value) return null;
  if (typeof value !== 'string') throw new Error('Invalid history cursor');
  const [timestamp, id, extra] = value.split('|');
  if (extra !== undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))
    || !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{1,19})$/i.test(id ?? '')) {
    throw new Error('Invalid history cursor');
  }
  return `created_at.lt.${timestamp},and(created_at.eq.${timestamp},id.lt.${id})`;
}

/** Input is descending with one lookahead row. Keep microseconds in the cursor. */
export function historyPage<Row extends HistoryRow>(rows: Row[]) {
  const items = rows.slice(0, HISTORY_PAGE_SIZE);
  return {
    items,
    older: rows.length > HISTORY_PAGE_SIZE ? historyCursor(items[items.length - 1]) : null,
  };
}

export function recentMessages<Row>(rows: Row[]) {
  return rows.slice(0, HISTORY_PAGE_SIZE).reverse();
}
