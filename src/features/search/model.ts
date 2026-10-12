import type { AppRole } from '@/types/database';
export type SearchResult = { id: string; label: string; detail?: string; href: string; group: 'Navigation' | 'Tickets' | 'People' | 'Articles' };
export function searchDestinations(role: AppRole, inventory: boolean): SearchResult[] {
  const employee = role === 'end_user';
  return [
    ['/app', employee ? 'Home' : 'Overview'], ['/app/tickets', employee ? 'My requests' : 'Ticket queue'], ['/app/chat', employee ? 'My chats' : 'Chats'],
    ['/app/help', employee ? 'Help articles' : 'Knowledge base'], ['/app/assets', employee ? 'My equipment' : 'Assets'],
    ...(inventory ? [['/app/inventory', employee ? 'Request an item' : 'Inventory']] : []),
    ...(!employee ? [['/app/people', 'People'], ['/app/reports', 'Reports']] : []),
    ...(role === 'administrator' ? [['/app/administration', 'Administration'], ['/app/organization', 'Organization']] : []),
    ['/app/profile', employee ? 'Account' : 'Profile'], ['/app/security', 'Security'], ['/app/support', 'Contact support'], ['/app/notifications', 'Notifications'],
  ].map(([href, label]) => ({ id: href, href, label, group: 'Navigation' }));
}
export function matchDestinations(results: SearchResult[], query: string) {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return results.filter(result => terms.every(term => result.label.toLocaleLowerCase().includes(term)));
}
