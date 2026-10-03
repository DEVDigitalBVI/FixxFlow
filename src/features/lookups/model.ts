export const lookupResources = ['people', 'technicians', 'teams', 'departments', 'locations', 'categories', 'subcategories'] as const;
export type LookupResource = typeof lookupResources[number];
export type LookupChoice = { id: string; label: string; active: boolean; parent_id: string | null };
export type LookupPage = { rows: LookupChoice[]; selected: LookupChoice | null; next: string | null };
export const LOOKUP_PAGE_SIZE = 50;
