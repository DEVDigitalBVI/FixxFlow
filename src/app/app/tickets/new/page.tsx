import { TicketSuggestions } from "@/features/knowledge/ticket-suggestions";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { TicketDraftCancel } from "@/features/tickets/ticket-draft-cancel";
import { CategoryFields } from "@/features/tickets/category-fields";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { ticketPriorities } from "@/features/tickets/presentation";
import { createTicket } from "../actions";

type Props = { searchParams: Promise<{ error?: string; asset?:string }> };
export default async function NewTicketPage({ searchParams }: Props) {
  const viewer = await requireViewer(); const message = await searchParams; const supabase = await createClient();
  const [profilesResult, membershipsResult, teamsResult, categoriesResult, subcategoriesResult, locationsResult, articlesResult] = await Promise.all([
    supabase.from("profiles").select("user_id, display_name").eq("organization_id", viewer.organizationId),
    supabase.from("organization_memberships").select("user_id, role, status").eq("organization_id", viewer.organizationId).eq("status", "active"),
    supabase.from("teams").select("id, name").eq("organization_id", viewer.organizationId).eq("is_active", true),
    supabase.from("ticket_categories").select("id, name, is_active").eq("organization_id", viewer.organizationId).eq("is_active", true).order("name"),
    supabase.from("ticket_subcategories").select("id, category_id, name, is_active").eq("organization_id", viewer.organizationId).eq("is_active", true).order("name"),
    supabase.from("locations").select("id, name").eq("organization_id", viewer.organizationId).eq("is_active", true),
    supabase.from("knowledge_articles").select("id, title, summary, category").eq("organization_id", viewer.organizationId).eq("status", "published").order("updated_at", { ascending: false }).order("id").limit(200),
  ]);
  const equipment = viewer.role === "end_user" && message.asset ? await supabase.from("assets").select("id,name,tag").eq("organization_id",viewer.organizationId).eq("assigned_user_id",viewer.id).eq("id",message.asset).maybeSingle() : null;
  const profiles = profilesResult.data ?? []; const members = membershipsResult.data ?? []; const activeIds = new Set(members.map(m => m.user_id)); const profileName = new Map(profiles.map(p => [p.user_id, p.display_name])); const technicians = members.filter(m => m.role !== "end_user");
  const staff = viewer.role !== "end_user";
  return <div className={staff ? "page page-narrow ticket-create-page" : "portal-page portal-form-page ticket-create-page"}>
    {staff ? <PageHeader title="New ticket" eyebrow="Ticket queue" description="Capture the issue and get it to the right people."/> : <header className="portal-page-heading"><div><h1>Open a ticket</h1><p>Tell IT what is happening. We’ll keep you updated here.</p></div></header>}
    {message.error && <div className="alert alert-error page-alert" role="alert">{message.error}</div>}
    <ActionForm action={createTicket} className={`ticket-create-form${staff ? "" : " portal-request-form"}`}>
      <div className="ticket-create-intro"><p>Fields marked <span aria-hidden="true">*</span><span className="sr-only">with an asterisk</span> are required. Everything else can be added later.</p></div>
      {equipment?.data && <div className="ticket-create-equipment"><input type="hidden" name="assetId" value={equipment.data.id}/><span className="muted">Request for your equipment</span><strong>{equipment.data.name}</strong><span>{equipment.data.tag}</span></div>}
      <section className="ticket-create-section" aria-labelledby="request-details-heading">
        <div className="ticket-create-section-heading"><h2 id="request-details-heading">{staff ? "Request details" : "What’s happening?"}</h2><p>{staff ? "A clear subject and a little context help support get started." : "Describe the problem and how it affects your work."}</p></div>
        <div className="ticket-create-fields">
          <div className="field field-wide"><label htmlFor="title">{staff ? "Subject" : "What do you need help with?"} <span aria-hidden="true">*</span></label><input className="input" id="title" name="title" required minLength={3} maxLength={180} aria-describedby="ticket-title-hint" placeholder={staff ? "For example, VPN disconnects during calls" : "For example, I can’t connect to Wi-Fi"}/><small className="muted" id="ticket-title-hint">Use a short, specific subject (3–180 characters).</small></div>
          <div className="field field-wide"><label htmlFor="description">{staff ? "Description" : "Tell us more"} <span aria-hidden="true">*</span></label><textarea className="input textarea" id="description" name="description" required maxLength={20000} rows={6} aria-describedby="ticket-description-hint" placeholder="What happened? What did you expect? What have you tried?"/><small className="muted" id="ticket-description-hint">Include any error messages or steps to reproduce the problem. Up to 20,000 characters.</small></div>
          {staff && <>
            <div className="field"><label htmlFor="requesterId">Requester</label><select className="input" id="requesterId" name="requesterId" defaultValue={viewer.id}>{profiles.filter(p => activeIds.has(p.user_id)).map(p => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select></div>
            <div className="field"><label htmlFor="priority">Priority</label><select className="input" id="priority" name="priority" defaultValue="normal">{Object.entries(ticketPriorities).map(([value, priority]) => <option key={value} value={value}>{priority.label}</option>)}</select></div>
          </>}
        </div>
      </section>
      <section className="ticket-create-section" aria-labelledby="request-context-heading">
        <div className="ticket-create-section-heading"><h2 id="request-context-heading">{staff ? "Classification" : "A little context"}</h2><p>{staff ? "Choose a category to help route and organize this ticket." : "These details are optional. Choose the closest match, or let IT help."}</p></div>
        <div className="ticket-create-fields">
          <CategoryFields categories={categoriesResult.data ?? []} subcategories={staff ? subcategoriesResult.data ?? [] : []} simple={!staff} error={!!categoriesResult.error || (staff && !!subcategoriesResult.error)}/>
          {!equipment?.data && <div className="field"><label htmlFor="locationId">{staff ? "Location" : "Where is the problem? (optional)"}</label><select className="input" id="locationId" name="locationId"><option value="">Not selected</option>{locationsResult.data?.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>}
        </div>
      </section>
      {staff && <details className="ticket-create-routing">
        <summary><span>Assignment &amp; timing</span>{" "}<span className="muted">Optional</span></summary>
        <p className="muted" id="ticket-routing-hint">The category’s default team is used automatically. Set an assignment or manual due date when you need one.</p>
        <div className="ticket-create-fields">
          <div className="field"><label htmlFor="teamId">Team</label><select className="input" id="teamId" name="teamId" defaultValue="automatic" aria-describedby="ticket-routing-hint"><option value="automatic">Automatic · use category default</option><option value="">Leave unassigned</option>{teamsResult.data?.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>
          <div className="field"><label htmlFor="assignedTechnicianId">Technician</label><select className="input" id="assignedTechnicianId" name="assignedTechnicianId"><option value="">Unassigned</option>{technicians.map(technician => <option key={technician.user_id} value={technician.user_id}>{profileName.get(technician.user_id) ?? "Team member"}</option>)}</select></div>
          <div className="field"><label htmlFor="dueAt">Manual due date</label><input className="input" id="dueAt" name="dueAt" type="datetime-local" aria-describedby="ticket-due-hint"/><small id="ticket-due-hint" className="muted">Optional. SLA targets are calculated separately.</small></div>
        </div>
      </details>}
      <div className="ticket-create-help"><TicketSuggestions articles={articlesResult.data ?? []} categories={categoriesResult.data ?? []} unavailable={!!articlesResult.error}/></div>
      <footer className="ticket-create-footer">
        <p className="form-note">You can add photos and files after creating {staff ? "the ticket" : "your request"}.</p>
        <div className="ticket-create-actions"><TicketDraftCancel href={staff ? "/app/tickets" : "/app"}/><SubmitButton className="button button-primary" pendingLabel={staff ? "Creating ticket…" : "Opening ticket…"}>{staff ? "Create ticket" : "Open ticket"}</SubmitButton></div>
      </footer>
    </ActionForm>
  </div>;
}
