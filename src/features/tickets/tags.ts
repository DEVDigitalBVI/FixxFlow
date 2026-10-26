/** Internal ticket labels. Mirrors private.prepare_ticket_tag and the table check. */
export const TICKET_TAG_LIMIT = 10;
export const TICKET_TAG_LENGTH = 40;
const TAG_PATTERN = /^[a-z0-9][a-z0-9 ._-]{0,39}$/;

/** Lowercase, trimmed, single-spaced; null when the result is not a valid tag. */
export function normalizeTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return TAG_PATTERN.test(tag) ? tag : null;
}

export const TAG_HINT =
  'Up to 40 characters: letters, numbers, spaces, dots, dashes or underscores. Tags are visible to IT staff only.';

/** Most-used tags first (ties alphabetical), for add-tag suggestions and filters. */
export function popularTags(usage: string[], limit = 50): string[] {
  const counts = new Map<string, number>();
  for (const tag of usage) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, limit)
    .map(([tag]) => tag);
}
