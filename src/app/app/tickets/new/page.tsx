import { randomUUID } from 'node:crypto';

import { PageHeader } from '@/components/ui/page-header';
import { SubmissionKey } from '@/components/ui/submission-key';
import { SubmitButton } from '@/components/ui/submit-button';
import { TicketSuggestions } from '@/features/knowledge/ticket-suggestions';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { ServiceAnnouncements } from '@/features/portal/service-announcements';
import { CategoryFields } from '@/features/tickets/category-fields';
import { DeadlineField } from '@/features/tickets/deadline-field';
import { ticketImpacts } from '@/features/tickets/impact';
import { ImpactExpectations } from '@/features/tickets/impact-expectations';
import { IncidentCreateFields } from '@/features/tickets/incident-fields';
import { InitialAttachmentsField, NewTicketForm } from '@/features/tickets/new-ticket-form';
import { ticketPriorities } from '@/features/tickets/presentation';
import { TicketDraftCancel } from '@/features/tickets/ticket-draft-cancel';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { createTicket } from '../actions';

type Props = { searchParams: Promise<{ error?: string; asset?: string }> };
export default async function NewTicketPage({ searchParams }: Props) {
  const viewer = await requireViewer();
  const message = await searchParams;
  const supabase = await createClient();
  const equipment =
    viewer.role === 'end_user' && message.asset
      ? await supabase
          .from('assets')
          .select('id,name,tag')
          .eq('organization_id', viewer.organizationId)
          .eq('assigned_user_id', viewer.id)
          .eq('id', message.asset)
          .maybeSingle()
      : null;
  const staff = viewer.role !== 'end_user';
  const contextFields = (
    <div className="ticket-create-fields">
      <CategoryFields simple={!staff} />
      {!equipment?.data && (
        <LookupSelect
          searchable={staff ? true : 'when-paginated'}
          resource="locations"
          guardSave={staff ? true : 'selection'}
          name="locationId"
          label={staff ? 'Location' : 'Location (optional)'}
        />
      )}
    </div>
  );

  return (
    <div
      className={
        staff
          ? 'page page-narrow ticket-create-page'
          : 'portal-page portal-form-page ticket-create-page'
      }
    >
      {staff ? (
        <PageHeader
          title="New ticket"
          eyebrow="Ticket queue"
          description="Capture the issue and get it to the right people."
        />
      ) : (
        <header className="portal-page-heading">
          <div>
            <span className="portal-kicker">IT support</span>
            <h1>Open a ticket</h1>
            <p>Tell IT what is happening. We’ll keep you updated here.</p>
          </div>
        </header>
      )}
      {message.error && (
        <div className="alert alert-error page-alert" role="alert">
          {message.error}
        </div>
      )}
      {!staff && <ServiceAnnouncements />}
      <NewTicketForm
        action={createTicket}
        className={`ticket-create-form${staff ? '' : ' portal-request-form'}`}
        organizationId={viewer.organizationId}
        userId={viewer.id}
      >
        <SubmissionKey value={randomUUID()} />
        {staff && (
          <div className="ticket-create-intro">
            <p>
              Fields marked <span aria-hidden="true">*</span>
              <span className="sr-only">with an asterisk</span> are required. Everything else can be
              added later.
            </p>
          </div>
        )}
        {equipment?.data && (
          <div className="ticket-create-equipment">
            <input type="hidden" name="assetId" value={equipment.data.id} />
            <span className="muted">Request for your equipment</span>
            <strong>{equipment.data.name}</strong>
            <span>{equipment.data.tag}</span>
          </div>
        )}
        <section
          className="ticket-create-section"
          aria-labelledby={staff ? 'request-details-heading' : undefined}
          aria-label={staff ? undefined : 'Your request'}
        >
          {staff ? (
            <div className="ticket-create-section-heading">
              <h2 id="request-details-heading">Request details</h2>
              <p>Describe the issue. Add assignment and timing only if needed.</p>
            </div>
          ) : (
            <p className="ticket-create-required">All three fields are required.</p>
          )}
          <div className="ticket-create-fields">
            <div className="field field-wide">
              <label htmlFor="title">
                {staff ? 'Subject' : 'What do you need help with?'}{' '}
                <span aria-hidden="true">*</span>
              </label>
              <input
                className="input"
                id="title"
                name="title"
                required
                minLength={3}
                maxLength={180}
                aria-describedby="ticket-title-hint"
                placeholder={
                  staff
                    ? 'For example, VPN disconnects during calls'
                    : 'For example, I can’t connect to Wi-Fi'
                }
              />
              <small className="muted" id="ticket-title-hint">
                {staff ? 'Use a short, specific subject.' : 'A short summary of the issue.'}
              </small>
            </div>
            <TicketSuggestions showAudience={staff} />
            <div className="field field-wide">
              <label htmlFor="description">
                {staff ? 'Description' : 'Tell us more'} <span aria-hidden="true">*</span>
              </label>
              <textarea
                className="input textarea"
                id="description"
                name="description"
                required
                maxLength={20000}
                rows={staff ? 6 : 5}
                aria-describedby="ticket-description-hint"
                placeholder="What happened? What did you expect? What have you tried?"
              />
              <small className="muted" id="ticket-description-hint">
                {staff
                  ? 'Include any error messages or steps to reproduce the problem. Up to 20,000 characters.'
                  : 'Include any error message and what you’ve tried.'}
              </small>
            </div>
            {!staff && (
              <div className="field field-wide">
                <label htmlFor="reportedImpact">
                  How is this affecting work? <span aria-hidden="true">*</span>
                </label>
                <select
                  className="input"
                  id="reportedImpact"
                  name="reportedImpact"
                  required
                  defaultValue=""
                  aria-describedby="ticket-impact-hint"
                >
                  <option value="" disabled>
                    Choose the impact
                  </option>
                  {Object.entries(ticketImpacts).map(([value, impact]) => (
                    <option key={value} value={value}>
                      {impact.label} — {impact.description}
                    </option>
                  ))}
                </select>
                <small className="muted" id="ticket-impact-hint">
                  This sets the initial urgency and service targets. IT can adjust them after
                  review.
                </small>
                <ImpactExpectations />
              </div>
            )}
            {staff && (
              <>
                <div className="field-wide">
                  <IncidentCreateFields ownerId={viewer.id} />
                </div>
                <LookupSelect
                  resource="people"
                  name="requesterId"
                  label="Requester"
                  defaultValue={viewer.id}
                  required
                />
                <div className="field">
                  <label htmlFor="priority">Priority</label>
                  <select className="input" id="priority" name="priority" defaultValue="normal">
                    {Object.entries(ticketPriorities).map(([value, priority]) => (
                      <option key={value} value={value}>
                        {priority.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </section>
        {staff ? (
          <section className="ticket-create-section" aria-labelledby="request-context-heading">
            <div className="ticket-create-section-heading">
              <h2 id="request-context-heading">Classification</h2>
              <p>Choose a category to help route and organize this ticket.</p>
            </div>
            {contextFields}
          </section>
        ) : (
          <details className="ticket-create-routing ticket-create-optional">
            <summary>
              {equipment?.data ? 'Add category' : 'Add category or location'}{' '}
              <span className="muted">Optional</span>
            </summary>
            <p className="muted">Not sure? Leave these for IT.</p>
            {contextFields}
          </details>
        )}
        {staff && (
          <details className="ticket-create-routing">
            <summary>
              <span>Assignment &amp; timing</span> <span className="muted">Optional</span>
            </summary>
            <p className="muted" id="ticket-routing-hint">
              The category’s default team is used automatically. Set an assignment or manual due
              date when you need one.
            </p>
            <div className="ticket-create-fields">
              <LookupSelect
                resource="teams"
                name="teamId"
                label="Team"
                defaultValue="automatic"
                emptyLabel="Leave unassigned"
                specialOptions={[{ id: 'automatic', label: 'Automatic · use category default' }]}
                describedBy="ticket-routing-hint"
              />
              <LookupSelect
                resource="technicians"
                name="assignedTechnicianId"
                label="Technician"
                emptyLabel="Unassigned"
              />
              <DeadlineField timeZone={viewer.timeZone} />
            </div>
          </details>
        )}

        <InitialAttachmentsField staff={staff} />
        <footer className="ticket-create-footer">
          <div className="ticket-create-actions">
            <TicketDraftCancel href={staff ? '/app/tickets' : '/app'} />
            <SubmitButton
              className="button button-primary"
              pendingLabel={staff ? 'Creating ticket…' : 'Sending request…'}
            >
              {staff ? 'Create ticket' : 'Submit request'}
            </SubmitButton>
          </div>
        </footer>
      </NewTicketForm>
    </div>
  );
}
