import { randomUUID } from "node:crypto";
import { SubmissionKey } from "@/components/ui/submission-key";
import { DeadlineField } from "@/features/tickets/deadline-field";
import { LookupSelect } from "@/features/lookups/lookup-select";
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
  const articlesResult = await supabase.from("knowledge_articles").select("id, title, summary, category").eq("organization_id", viewer.organizationId).eq("status", "published").order("updated_at", { ascending: false }).order("id").limit(200);
  const equipment = viewer.role === "end_user" && message.asset ? await supabase.from("assets").select("id,name,tag").eq("organization_id",viewer.organizationId).eq("assigned_user_id",viewer.id).eq("id",message.asset).maybeSingle() : null;
  const staff = viewer.role !== "end_user";
  return <div className={staff ? "page page-narrow ticket-create-page" : "portal-page portal-form-page ticket-create-page"}>
    {staff ? <PageHeader title="New ticket" eyebrow="Ticket queue" description="Capture the issue and get it to the right people."/> : <header className="portal-page-heading"><div><h1>Open a ticket</h1><p>Tell IT what is happening. We’ll keep you updated here.</p></div></header>}
    {message.error && <div className="alert alert-error page-alert" role="alert">{message.error}</div>}
    <ActionForm action={createTicket} className={`ticket-create-form${staff ? "" : " portal-request-form"}`}>
      <SubmissionKey value={randomUUID()}/>
      <div className="ticket-create-intro"><p>Fields marked <span aria-hidden="true">*</span><span className="sr-only">with an asterisk</span> are required. Everything else can be added later.</p></div>
      {equipment?.data && <div className="ticket-create-equipment"><input type="hidden" name="assetId" value={equipment.data.id}/><span className="muted">Request for your equipment</span><strong>{equipment.data.name}</strong><span>{equipment.data.tag}</span></div>}
      <section className="ticket-create-section" aria-labelledby="request-details-heading">
        <div className="ticket-create-section-heading"><h2 id="request-details-heading">{staff ? "Request details" : "What’s happening?"}</h2><p>{staff ? "A clear subject and a little context help support get started." : "Describe the problem and how it affects your work."}</p></div>
        <div className="ticket-create-fields">
          <div className="field field-wide"><label htmlFor="title">{staff ? "Subject" : "What do you need help with?"} <span aria-hidden="true">*</span></label><input className="input" id="title" name="title" required minLength={3} maxLength={180} aria-describedby="ticket-title-hint" placeholder={staff ? "For example, VPN disconnects during calls" : "For example, I can’t connect to Wi-Fi"}/><small className="muted" id="ticket-title-hint">Use a short, specific subject (3–180 characters).</small></div>
          <div className="field field-wide"><label htmlFor="description">{staff ? "Description" : "Tell us more"} <span aria-hidden="true">*</span></label><textarea className="input textarea" id="description" name="description" required maxLength={20000} rows={6} aria-describedby="ticket-description-hint" placeholder="What happened? What did you expect? What have you tried?"/><small className="muted" id="ticket-description-hint">Include any error messages or steps to reproduce the problem. Up to 20,000 characters.</small></div>
          {staff && <>
            <LookupSelect resource="people" name="requesterId" label="Requester" defaultValue={viewer.id} required/>
            <div className="field"><label htmlFor="priority">Priority</label><select className="input" id="priority" name="priority" defaultValue="normal">{Object.entries(ticketPriorities).map(([value, priority]) => <option key={value} value={value}>{priority.label}</option>)}</select></div>
          </>}
        </div>
      </section>
      <section className="ticket-create-section" aria-labelledby="request-context-heading">
        <div className="ticket-create-section-heading"><h2 id="request-context-heading">{staff ? "Classification" : "A little context"}</h2><p>{staff ? "Choose a category to help route and organize this ticket." : "These details are optional. Choose the closest match, or let IT help."}</p></div>
        <div className="ticket-create-fields">
          <CategoryFields simple={!staff}/>
          {!equipment?.data && <LookupSelect resource="locations" name="locationId" label={staff ? "Location" : "Where is the problem? (optional)"}/>}
        </div>
      </section>
      {staff && <details className="ticket-create-routing">
        <summary><span>Assignment &amp; timing</span>{" "}<span className="muted">Optional</span></summary>
        <p className="muted" id="ticket-routing-hint">The category’s default team is used automatically. Set an assignment or manual due date when you need one.</p>
        <div className="ticket-create-fields">
          <LookupSelect resource="teams" name="teamId" label="Team" defaultValue="automatic" emptyLabel="Leave unassigned" specialOptions={[{id:"automatic",label:"Automatic · use category default"}]} describedBy="ticket-routing-hint"/>
          <LookupSelect resource="technicians" name="assignedTechnicianId" label="Technician" emptyLabel="Unassigned"/>
          <DeadlineField timeZone={viewer.timeZone}/>
        </div>
      </details>}
      <div className="ticket-create-help"><TicketSuggestions articles={articlesResult.data ?? []} categories={[]} unavailable={!!articlesResult.error}/></div>
      <footer className="ticket-create-footer">
        <p className="form-note">You can add photos and files after creating {staff ? "the ticket" : "your request"}.</p>
        <div className="ticket-create-actions"><TicketDraftCancel href={staff ? "/app/tickets" : "/app"}/><SubmitButton className="button button-primary" pendingLabel={staff ? "Creating ticket…" : "Opening ticket…"}>{staff ? "Create ticket" : "Open ticket"}</SubmitButton></div>
      </footer>
    </ActionForm>
  </div>;
}
