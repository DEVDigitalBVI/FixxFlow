import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { CategoryFields } from "@/features/tickets/category-fields";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { ticketPriorities } from "@/features/tickets/presentation";
import { createTicket } from "../actions";

type Props = { searchParams: Promise<{ error?: string }> };
export default async function NewTicketPage({ searchParams }: Props) {
  const viewer = await requireViewer(); const message = await searchParams; const supabase = await createClient();
  const [profilesResult, membershipsResult, teamsResult, categoriesResult, subcategoriesResult, locationsResult] = await Promise.all([
    supabase.from("profiles").select("user_id, display_name").eq("organization_id", viewer.organizationId),
    supabase.from("organization_memberships").select("user_id, role, status").eq("organization_id", viewer.organizationId).eq("status", "active"),
    supabase.from("teams").select("id, name").eq("organization_id", viewer.organizationId).eq("is_active", true),
    supabase.from("ticket_categories").select("id, name, is_active").eq("organization_id", viewer.organizationId).eq("is_active", true).order("name"),
    supabase.from("ticket_subcategories").select("id, category_id, name, is_active").eq("organization_id", viewer.organizationId).eq("is_active", true).order("name"),
    supabase.from("locations").select("id, name").eq("organization_id", viewer.organizationId).eq("is_active", true),
  ]);
  const profiles = profilesResult.data ?? []; const members = membershipsResult.data ?? []; const activeIds = new Set(members.map(m => m.user_id)); const profileName = new Map(profiles.map(p => [p.user_id, p.display_name])); const technicians = members.filter(m => m.role !== "end_user");
  if (viewer.role === "end_user") return <div className="portal-page portal-form-page"><header className="portal-page-heading"><div><Link href="/app">← Home</Link><h1>Submit a request</h1><p>Tell IT what is happening. We’ll keep you updated here.</p></div></header>{message.error && <div className="alert alert-error page-alert" role="alert">{message.error}</div>}<form action={createTicket} className="settings-card portal-request-form"><div className="field"><label htmlFor="title">What do you need help with?</label><input className="input" id="title" name="title" required minLength={3} maxLength={180} placeholder="For example, I can’t connect to Wi-Fi" /></div><div className="field"><label htmlFor="description">Tell us more</label><textarea className="input textarea" id="description" name="description" required maxLength={20000} rows={6} placeholder="What happened? What have you tried?" /></div><CategoryFields categories={categoriesResult.data ?? []} simple error={!!categoriesResult.error}/><p className="form-note">You can add a photo or file after creating your request.</p><SubmitButton className="button button-primary" type="submit" pendingLabel="Sending request…">Send request</SubmitButton></form></div>;
  return <div className="page page-narrow"><header className="page-header"><div><span className="page-eyebrow">Service desk</span><h1>New ticket</h1><p>Tell the support team what you need help with.</p></div><Link className="button button-secondary" href="/app/tickets">Cancel</Link></header>{message.error && <div className="alert alert-error page-alert" role="alert">{message.error}</div>}
    <form action={createTicket} className="settings-card ticket-form"><div className="field field-wide"><label htmlFor="title">Title</label><input className="input" id="title" name="title" required minLength={3} maxLength={180} placeholder="Briefly describe the issue" /></div><div className="field field-wide"><label htmlFor="description">Description</label><textarea className="input textarea" id="description" name="description" required maxLength={20000} rows={7} placeholder="What happened, what did you expect, and how is it affecting your work?" /></div>
      <div className="field"><label htmlFor="requesterId">Requester</label><select className="input" id="requesterId" name="requesterId" defaultValue={viewer.id}>{profiles.filter(p => activeIds.has(p.user_id)).map(p => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></div>
      <div className="field"><label htmlFor="priority">Priority</label><select className="input" id="priority" name="priority" defaultValue="normal">{Object.entries(ticketPriorities).map(([v,p]) => <option key={v} value={v}>{p.label}</option>)}</select></div>
      <CategoryFields categories={categoriesResult.data ?? []} subcategories={subcategoriesResult.data ?? []} error={!!categoriesResult.error || !!subcategoriesResult.error}/>
      <div className="field"><label htmlFor="locationId">Location</label><select className="input" id="locationId" name="locationId"><option value="">Not selected</option>{locationsResult.data?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
      <><div className="field"><label htmlFor="teamId">Team</label><select className="input" id="teamId" name="teamId"><option value="">Unassigned</option>{teamsResult.data?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div><div className="field"><label htmlFor="assignedTechnicianId">Technician</label><select className="input" id="assignedTechnicianId" name="assignedTechnicianId"><option value="">Unassigned</option>{technicians.map(v => <option key={v.user_id} value={v.user_id}>{profileName.get(v.user_id) ?? "Team member"}</option>)}</select></div><div className="field"><label htmlFor="dueAt">Due date</label><input className="input" id="dueAt" name="dueAt" type="datetime-local" /></div></>
      <div className="form-actions"><SubmitButton className="button button-primary" type="submit" pendingLabel="Creating ticket…">Create ticket</SubmitButton></div></form></div>;
}
