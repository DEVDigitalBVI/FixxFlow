/** Shared contract with private.search_patterns: literal fragments, all terms. */
export const SEARCH_LIMIT = 200;
export const SEARCH_HINT = 'Matches any part, ignoring case. Add words to narrow results.';

export function normalizeSearch(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, SEARCH_LIMIT).trim() : '';
}
