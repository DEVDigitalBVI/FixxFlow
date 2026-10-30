'use client';

import { useId, useState } from 'react';

import { NativeSelect, Textarea } from '@/components/ui/input';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { useTimezone } from '@/features/timezones/provider';

import { DeadlineField } from './deadline-field';
import { incidentSeverities, type Incident } from './incidents';

export function IncidentFields({
  incident,
  ownerId,
  disabled = false,
}: {
  incident?: Incident | null;
  ownerId: string;
  disabled?: boolean;
}) {
  const id = useId();
  const timeZone = useTimezone();
  return (
    <fieldset className="stack incident-fields" disabled={disabled}>
      <legend>Incident coordination</legend>
      <p className="muted" id={`${id}-severity-hint`}>
        Severity describes business impact. Ticket priority controls urgency. These coordination
        details are visible to IT staff only.
      </p>
      <label className="field" htmlFor={`${id}-severity`}>
        Severity *
        <NativeSelect
          id={`${id}-severity`}
          name="incidentSeverity"
          required
          defaultValue={incident?.severity ?? ''}
          aria-describedby={`${id}-severity-hint`}
        >
          <option value="">Choose severity</option>
          {Object.entries(incidentSeverities).map(([value, item]) => (
            <option key={value} value={value}>
              {item.label} · {item.description}
            </option>
          ))}
        </NativeSelect>
      </label>
      <LookupSelect
        searchable="when-paginated"
        resource="technicians"
        name="incidentOwnerId"
        label="Incident owner"
        defaultValue={incident?.owner_id ?? ownerId}
        required
      />
      <label className="field" htmlFor={`${id}-impact`}>
        Business impact *
        <Textarea
          id={`${id}-impact`}
          fieldSize="tall"
          name="businessImpact"
          required
          minLength={3}
          maxLength={4000}
          rows={3}
          defaultValue={incident?.business_impact ?? ''}
          placeholder="Who is affected, and which work cannot continue?"
        />
      </label>
      <label className="field" htmlFor={`${id}-services`}>
        Affected services
        <Textarea
          id={`${id}-services`}
          name="affectedServices"
          maxLength={3630}
          rows={2}
          defaultValue={incident?.affected_services.join('\n') ?? ''}
          aria-describedby={`${id}-names-hint`}
        />
      </label>
      <label className="field" htmlFor={`${id}-locations`}>
        Affected locations
        <Textarea
          id={`${id}-locations`}
          name="affectedLocations"
          maxLength={3630}
          rows={2}
          defaultValue={incident?.affected_locations.join('\n') ?? ''}
          aria-describedby={`${id}-names-hint`}
        />
      </label>
      <details>
        <summary>Service timing (optional)</summary>
        <div className="stack">
          <DeadlineField
            name="disruption"
            timeZone={timeZone}
            value={incident?.disruption_started_at}
            label="Disruption started"
            hint="When service was affected, even if before this ticket."
          />
          <DeadlineField
            name="restored"
            timeZone={timeZone}
            value={incident?.service_restored_at}
            label="Service restored"
            hint="Used for downtime reporting, separate from ticket resolution."
          />
        </div>
      </details>
      <small className="muted" id={`${id}-names-hint`}>
        Enter names, one per line. Up to 30 per field, 120 characters per name.
      </small>
    </fieldset>
  );
}
export function IncidentCreateFields({ ownerId }: { ownerId: string }) {
  const [type, setType] = useState('support');
  const [usedIncident, setUsedIncident] = useState(false);
  const id = useId();
  return (
    <div className="stack">
      <label className="field" htmlFor={id}>
        Ticket type
        <NativeSelect
          id={id}
          name="ticketType"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            if (event.target.value === 'incident') setUsedIncident(true);
          }}
        >
          <option value="support">Support request</option>
          <option value="incident">Incident · broader disruption</option>
        </NativeSelect>
      </label>
      {usedIncident && (
        <div hidden={type !== 'incident'}>
          <IncidentFields ownerId={ownerId} disabled={type !== 'incident'} />
        </div>
      )}
    </div>
  );
}
