import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Viewer } from '@/lib/auth/viewer';
import type { TicketPriority, TicketStatus } from '@/types/database';
import { ticketPriorities, ticketStatuses } from './presentation';
import { normalizeQueueFilters } from './queue-filters';
import { pageNumber } from '@/lib/pagination';

export type TicketQueueFilters = { page?: string; view?: string; team?: string; status?: string; priority?: string; q?: string; sort?: string; overdue?: string; sla?: string; success?: string; error?: string };
const active: TicketStatus[] = ["new", "open", "in_progress", "waiting_on_user", "on_hold"];

export async function loadTicketQueue(viewer: Viewer, filters: TicketQueueFilters) {
  const supabase = await createClient();
  const { view, sort, search } = normalizeQueueFilters(filters);
  const page = pageNumber(filters.page, 10000);
  const source = search ? supabase.rpc("search_tickets", { target_organization_id: viewer.organizationId, search_text: search }) : supabase.from("tickets");
  let query = source.select("id, ticket_number, title, requester_id, assigned_technician_id, team_id, priority, status, due_at, created_at, updated_at, first_response_at, resolved_at, closed_at, response_sla_due_at, resolution_sla_due_at, sla_next_due_at").eq("organization_id", viewer.organizationId);
  if (viewer.role === "end_user") query = query.eq("requester_id", viewer.id);
  else {
    if (view === "mine") query = query.eq("assigned_technician_id", viewer.id).in("status", active);
    if (view === "unassigned") query = query.is("assigned_technician_id", null).in("status", active);
    if (view === "team") query = query.not("team_id", "is", null).in("status", active);
    if (filters.team && /^[0-9a-f-]{36}$/i.test(filters.team)) query = query.eq("team_id", filters.team);
    if (filters.sla === "breached") query = query.lte("sla_next_due_at", new Date().toISOString());
    if (filters.overdue === "1") query = query.lt("due_at", new Date().toISOString()).in("status", active);
  }
  if (filters.status && filters.status in ticketStatuses) query = query.eq("status", filters.status as TicketStatus);
  if (filters.priority && filters.priority in ticketPriorities) query = query.eq("priority", filters.priority as TicketPriority);
  if (sort === "oldest") query = query.order("updated_at", { ascending: true });
  else if (sort === "newest") query = query.order("created_at", { ascending: false });
  else if (sort === "sla") query = query.order("sla_next_due_at", { ascending: true, nullsFirst: false });
  else if (sort === "due") query = query.order("due_at", { ascending: true, nullsFirst: false });
  else if (sort === "priority") query = query.order("priority", { ascending: false }).order("updated_at", { ascending: false });
  else query = query.order("updated_at", { ascending: false });
  const [{ data: rows, error }, { data: profiles }, { data: teams }, { data: members }, { count: knowledgeCount }] = await Promise.all([
    query.order("id").range((page - 1) * 50, page * 50),
    viewer.role === "end_user" ? Promise.resolve({ data: [] }) : supabase.from("profiles").select("user_id, display_name").eq("organization_id", viewer.organizationId),
    viewer.role === "end_user" ? Promise.resolve({ data: [] }) : supabase.from("teams").select("id, name").eq("organization_id", viewer.organizationId).eq("is_active", true),
    viewer.role === "end_user" ? Promise.resolve({ data: [] }) : supabase.from("organization_memberships").select("user_id").eq("organization_id", viewer.organizationId).eq("status", "active").in("role", ["technician", "administrator"]),
    search ? supabase.rpc("search_knowledge_articles", { target_organization_id: viewer.organizationId, search_text: search }, { count: "exact", head: true }).select("id").eq("status", "published") : Promise.resolve({ count: null }),
  ]);
  return { view, sort, search, page, rows, error, profiles, teams, members, knowledgeCount };
}
