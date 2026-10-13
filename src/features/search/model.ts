import type { AppRole } from '@/types/database';
export type SearchResult = { id: string; label: string; detail?: string; keywords?: string[]; href: string; group: 'Navigation' | 'Tickets' | 'People' | 'Articles' };
export function searchDestinations(role: AppRole, inventory: boolean): SearchResult[] {
  const employee = role === 'end_user';
  const keywords: Record<string, string[]> = {
    '/app': ['overview', 'home'],
    '/app/tickets': ['requests', 'issues'],
    '/app/chat': ['chats', 'messages'],
    '/app/help': ['help', 'articles', 'guides'],
    '/app/administration': ['administration', 'admin', 'configuration'],
  };
  return [
    ['/app', employee ? 'Home' : 'Dashboard'], ['/app/tickets', employee ? 'My requests' : 'Ticket queue'], ['/app/chat', employee ? 'My chats' : 'Live chat'],
    ['/app/help', employee ? 'Help articles' : 'Knowledge base'], ['/app/assets', employee ? 'My equipment' : 'Assets'],
    ...(inventory ? [['/app/inventory', employee ? 'Request an item' : 'Inventory']] : []),
    ...(!employee ? [['/app/people', 'People'], ['/app/reports', 'Reports']] : []),
    ...(role === 'administrator' ? [['/app/administration', 'Settings'], ['/app/organization', 'Organization']] : []),
    ['/app/profile', employee ? 'Account' : 'Profile'], ['/app/security', 'Security'], ['/app/support', 'Contact support'], ['/app/notifications', 'Notifications'],
  ].map(([href, label]) => ({ id: href, href, label, keywords: keywords[href], group: 'Navigation' }));
}
export function matchDestinations(results: SearchResult[], query: string) {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return results.filter(result => {
    const searchable = [result.label, result.detail, ...(result.keywords ?? [])].filter(Boolean).join(' ').toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}

/** Retain flat indices so grouped options and keyboard selection share IDs. */
export function groupSearchResults(results: SearchResult[]) {
  const groups = new Map<SearchResult['group'], { result: SearchResult; index: number }[]>();
  results.forEach((result, index) => {
    const entries = groups.get(result.group);
    if (entries) entries.push({ result, index });
    else groups.set(result.group, [{ result, index }]);
  });
  return [...groups].map(([label, entries]) => ({ label, entries }));
}
