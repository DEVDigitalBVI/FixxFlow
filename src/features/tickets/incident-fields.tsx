'use client';

import { useId, useState } from 'react';

import { LookupSelect } from '@/features/lookups/lookup-select';

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
  return (
    <fieldset className="stack incident-fields" disabled={disabled}>
      <legend>Incident coordination</legend>
      <p className="muted" id={`${id}-severity-hint`}>
        Severity describes business impact. Ticket priority controls urgency. These coordination
        details are visible to IT staff only.
      </p>
      <label className="field" htmlFor={`${id}-severity`}>
        Severity *
        <select
          id={`${id}-severity`}
          className="input"
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
        </select>
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
        <textarea
          id={`${id}-impact`}
          className="input textarea"
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
        <textarea
          id={`${id}-services`}
          className="input"
          name="affectedServices"
          maxLength={3630}
          rows={2}
          defaultValue={incident?.affected_services.join('\n') ?? ''}
          aria-describedby={`${id}-names-hint`}
        />
      </label>
      <label className="field" htmlFor={`${id}-locations`}>
        Affected locations
        <textarea
          id={`${id}-locations`}
          className="input"
          name="affectedLocations"
          maxLength={3630}
          rows={2}
          defaultValue={incident?.affected_locations.join('\n') ?? ''}
          aria-describedby={`${id}-names-hint`}
        />
      </label>
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
        <select
          className="input"
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
        </select>
      </label>
      {usedIncident && (
        <div hidden={type !== 'incident'}>
          <IncidentFields ownerId={ownerId} disabled={type !== 'incident'} />
        </div>
      )}
    </div>
  );
}
