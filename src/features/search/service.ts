import 'server-only';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { normalizeSearch } from '@/lib/search';
import type { SearchResult } from './model';

export async function searchWorkspace(raw: string) {
  const viewer = await requireViewer(), q = normalizeSearch(raw);
  if (!q) return [];
  const db = await createClient();
  // PostgREST orders RPC results after projection, so retain the sort column.
  let tickets = db.rpc('search_tickets', { target_organization_id: viewer.organizationId, search_text: q }).select('id,ticket_number,title,updated_at').eq('organization_id', viewer.organizationId);
  if (viewer.role === 'end_user') tickets = tickets.eq('requester_id', viewer.id);
  const [ticketRows, articles, people] = await Promise.all([
    tickets.order('updated_at', { ascending: false }).order('id').limit(8),
    db.rpc('search_knowledge_articles', { target_organization_id: viewer.organizationId, search_text: q }).select('id,title').eq('organization_id', viewer.organizationId).eq('status', 'published').order('title').order('id').limit(8),
    viewer.role !== 'end_user' ? db.rpc('search_members', { target_organization_id: viewer.organizationId, search_text: q }).select('user_id').eq('organization_id', viewer.organizationId).order('user_id').limit(8) : { data: [], error: null },
  ]);
  if (ticketRows.error || articles.error || people.error) throw new Error('Search unavailable');
  const ids = (people.data ?? []).map(person => person.user_id);
  const profiles = ids.length ? await db.from('profiles').select('user_id,display_name,email').eq('organization_id', viewer.organizationId).in('user_id', ids).order('display_name') : { data: [], error: null };
  if (profiles.error) throw new Error('People unavailable');
  return [
    ...(ticketRows.data ?? []).map(ticket => ({ id: ticket.id, group: 'Tickets', label: ticket.title, detail: `#${ticket.ticket_number}`, href: `/app/tickets/${ticket.id}` })),
    ...(profiles.data ?? []).map(person => ({ id: person.user_id, group: 'People', label: person.display_name, detail: person.email, href: `/app/people?${new URLSearchParams({ q: person.email ?? person.display_name })}` })),
    ...(articles.data ?? []).map(article => ({ id: article.id, group: 'Articles', label: article.title, href: `/app/help/${article.id}` })),
  ] as SearchResult[];
}
