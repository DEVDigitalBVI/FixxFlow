import { randomUUID } from 'node:crypto';
import { PermissionsForm } from '@/features/inventory/forms';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { pageNumber } from "@/lib/pagination";
import { normalizeSearch, SEARCH_HINT, SEARCH_LIMIT } from '@/lib/search';
import { PersonCard } from "@/features/administration/person-card";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { rolePresentation } from "@/features/identity/role";
import { inviteMember, updateMemberRole, updateMemberStatus } from "./actions";


type Props = { searchParams: Promise<{ error?: string; success?: string; view?: string; invite?: string; q?: string; page?: string }> };

export default async function PeoplePage({ searchParams }: Props) {
  const viewer = await requireViewer(); if (viewer.role === "end_user") notFound();
  const message = await searchParams;
  const supabase = await createClient();
  const page = pageNumber(message.page, 999999);
  const search = normalizeSearch(message.q);
  const source = search
    ? supabase.rpc('search_members',{target_organization_id:viewer.organizationId,search_text:search},{count:'exact'})
    : supabase.from('organization_memberships');
  let membersQuery = source.select('user_id, role, status', {count:'exact'}).eq("organization_id", viewer.organizationId).order("created_at").order("user_id");
  if (message.view === "technicians") membersQuery = membersQuery.eq("role", "technician");
  const [{ data: memberships, error: membersError, count }, departments, locations] = await Promise.all([
    membersQuery.range((page - 1) * 25, page * 25 - 1),
    viewer.role === "administrator" ? supabase.from("departments").select("id, name, is_active").eq("organization_id", viewer.organizationId).order("name") : Promise.resolve({ data: [], error: null }),
    viewer.role === "administrator" ? supabase.from("locations").select("id, name, is_active").eq("organization_id", viewer.organizationId).order("name") : Promise.resolve({ data: [], error: null }),
  ]);
  if (membersError) throw new Error("Unable to load members.");
  const { data: profiles, error: profilesError } = memberships?.length
    ? await supabase.from("profiles").select("user_id, display_name, email, job_title, avatar_path, department_id, location_id, updated_at").eq("organization_id", viewer.organizationId).in("user_id", memberships.map(member => member.user_id))
    : { data: [], error: null };
  if (profilesError || departments.error || locations.error) throw new Error("Unable to load member details. Please try again.");
  const [inventoryManagers, inventoryRequesters] = viewer.role === 'administrator' && memberships?.length ? await Promise.all([
    supabase.from('inventory_managers').select('user_id').eq('organization_id',viewer.organizationId).in('user_id',memberships.map(m=>m.user_id)),
    supabase.from('inventory_requesters').select('user_id,department_id').eq('organization_id',viewer.organizationId).in('user_id',memberships.map(m=>m.user_id)),
  ]) : [{data:[],error:null},{data:[],error:null}];
  if (inventoryManagers.error || inventoryRequesters.error) throw new Error('Inventory permissions could not load. Try again.');
  const pageHref = (target: number) => `/app/people?${new URLSearchParams({ page: String(target), q: search, ...(message.view === 'technicians' ? { view: 'technicians' } : {}) })}`;
  const profilesByUser = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  const avatarPaths = (profiles ?? []).flatMap((profile) => profile.avatar_path ? [profile.avatar_path] : []);
  const { data: signedAvatars } = avatarPaths.length ? await supabase.storage.from("profile-photos").createSignedUrls(avatarPaths, 3600) : { data: [] };
  const avatarsByPath = new Map((signedAvatars ?? []).map((avatar) => [avatar.path, avatar.signedUrl]));
  const canManage = viewer.role === 'administrator';
  const technicians = message.view === 'technicians';
  const context = new URLSearchParams({ ...(search ? {q: search} : {}), ...(technicians ? {view: 'technicians'} : {}), ...(page > 1 ? {page: String(page)} : {}) });
  const directoryHref = `/app/people${context.size ? `?${context}` : ''}`;
  const inviteHref = `/app/people?${new URLSearchParams([...context, ['invite', '1']])}#invite-member`;
  const viewHref = (value: string) => `/app/people?${new URLSearchParams({ ...(search ? {q: search} : {}), ...(value ? {view: value} : {}) })}`;
  return <div className="page people-page">
    <PageHeader title={technicians ? 'Technicians' : 'People'} eyebrow={viewer.organizationName} description={canManage ? 'Your people, their roles and the access they need.' : 'Find the people in your workspace.'} back={canManage ? {href: '/app/administration', label: 'Back to Administration'} : undefined} actions={canManage ? <Link className="button button-primary" href={inviteHref}>Invite member</Link> : undefined}/>
    {message.error && <div className="alert alert-error" role="alert">{message.error}</div>}
    {message.success && <div className="alert alert-success" role="status">{message.success}</div>}
    {canManage && message.invite === '1' && <section id="invite-member" className="settings-card people-invitation" aria-labelledby="invite-heading">
      <div><span className="section-kicker">Grow your workspace</span><h2 id="invite-heading">Invite someone to FixxFlow</h2><p className="muted">They’ll receive an email to set up their account. Choose the access they need.</p></div>
      <form action={inviteMember} className="people-invite-form">
        <div className="field"><label htmlFor="invite-name">Full name</label><input id="invite-name" className="input" name="displayName" autoComplete="name" autoFocus required maxLength={120}/></div>
        <div className="field"><label htmlFor="invite-email">Work email</label><input id="invite-email" className="input" name="email" type="email" autoComplete="email" placeholder="name@company.com" required/></div>
        <div className="field"><label htmlFor="invite-role">Workspace role</label><select id="invite-role" className="input" name="role" defaultValue={technicians ? 'technician' : 'end_user'}>{Object.entries(rolePresentation).map(([role, item]) => <option key={role} value={role}>{item.label}</option>)}</select></div>
        <div className="people-invite-actions"><SubmitButton className="button button-primary" pendingLabel="Sending invitation…">Send invitation</SubmitButton><Link className="button button-quiet" href={directoryHref}>Cancel</Link></div>
      </form>
    </section>}
    <section className="people-directory" aria-labelledby="people-directory-heading">
      <header className="people-directory-heading"><div><h2 id="people-directory-heading">{search ? 'Search results' : technicians ? 'Your technicians' : 'Your workspace'}</h2><p>{search ? 'People matching your search' : technicians ? 'Members with the Technician role' : 'Everyone with access to this workspace'}</p></div>
        <span className="people-count" aria-label={`${count ?? 0} ${(count ?? 0) === 1 ? 'person' : 'people'}`}><strong>{count ?? 0}</strong><span>{(count ?? 0) === 1 ? 'person' : 'people'}</span></span>
      </header>
      <nav className="queue-views people-views" aria-label="People views"><Link href={viewHref('')} aria-current={!technicians ? 'page' : undefined}>All people</Link><Link href={viewHref('technicians')} aria-current={technicians ? 'page' : undefined}>Technicians</Link></nav>
      <div className="people-directory-toolbar"><LiveSearchForm action="/app/people" className="people-search" label="Search people" resultSummary={`${count ?? 0} matching people. Page ${page}.`}>
        {technicians && <input type="hidden" name="view" value="technicians"/>}
        <div className="field"><label htmlFor="people-search">Search name, email or job title</label><input type="search" className="input" id="people-search" name="q" defaultValue={search} placeholder="Find someone in your workspace…" maxLength={SEARCH_LIMIT} aria-describedby="people-search-hint"/></div>
        <button type="submit" className="button button-secondary">Search</button>{search && <Link className="button button-quiet" href={technicians ? '/app/people?view=technicians' : '/app/people'}>Clear search</Link>}
      </LiveSearchForm><span className="sr-only" id="people-search-hint">{SEARCH_HINT}</span></div>
      {memberships?.length ? <ul className="people-list">{memberships.map(member => {
        const profile = profilesByUser.get(member.user_id), name = profile?.display_name ?? 'Profile incomplete';
        return <PersonCard inventoryPermissions={canManage ? <PermissionsForm id={member.user_id} name={name} departments={departments.data ?? []} grants={(inventoryRequesters.data ?? []).filter(r=>r.user_id===member.user_id).map(r=>r.department_id)} manager={(inventoryManagers.data ?? []).some(m=>m.user_id===member.user_id)} token={randomUUID()}/> : undefined} key={member.user_id} id={member.user_id} name={name} email={profile?.email ?? (member.user_id === viewer.id ? 'Your account' : 'Invitation pending')} avatarUrl={profile?.avatar_path ? avatarsByPath.get(profile.avatar_path) : null} role={member.role} status={member.status} isSelf={member.user_id === viewer.id} canManage={canManage} profile={profile} departments={departments.data ?? []} locations={locations.data ?? []} updateRole={updateMemberRole} updateStatus={updateMemberStatus}/>;
      })}</ul> : <div className="empty-state people-empty"><h3>{search ? 'No people match your search' : technicians ? 'No technicians here yet' : page > 1 ? 'No people on this page' : 'Bring your people together'}</h3><p>{search ? 'Try another name, email or job title, or clear your search.' : technicians ? 'Members with the Technician role will appear here.' : 'Workspace members and their access will appear here.'}</p><Link className="button button-secondary" href={search ? (technicians ? '/app/people?view=technicians' : '/app/people') : canManage && !technicians && page === 1 ? inviteHref : '/app/people'}>{search ? 'Clear search' : canManage && !technicians && page === 1 ? 'Invite your first member' : 'View all people'}</Link></div>}
      <footer className="people-directory-footer"><span className="muted">{count ? `${Math.min((page - 1) * 25 + 1, count)}–${Math.min(page * 25, count)} of ${count}` : 'No results'}</span><nav className="people-pagination" aria-label="People pages">{page > 1 && <Link className="button button-secondary" href={pageHref(page - 1)}>Previous</Link>}<span>Page {page}</span>{page * 25 < (count ?? 0) && <Link className="button button-secondary" href={pageHref(page + 1)}>Next</Link>}</nav></footer>
    </section>
  </div>;
}
