'use client';
import { useState } from 'react';
import type { AutomationTrigger } from './model';
import { isTemporalTrigger } from './domains/tickets/temporal';

export function TemporalControls({ trigger, onChange, invalid = false }: { trigger: AutomationTrigger; onChange: (trigger: AutomationTrigger) => void; invalid?: boolean }) {
  const initial = Number(trigger.configuration.durationMinutes);
  const [unit, setUnit] = useState(initial % 1440 === 0 ? 1440 : initial % 60 === 0 ? 60 : 1);
  if (!isTemporalTrigger(trigger.type)) return null;
  const config = trigger.configuration;
  return <div className="stack">
    <div className="automation-condition-grid">
      {trigger.type.startsWith('ticket.sla_') && <div className="field"><label htmlFor="automation-sla-objective">SLA requirement</label><select id="automation-sla-objective" className="input" aria-invalid={invalid || undefined} aria-describedby={invalid ? 'automation-trigger-error' : undefined} value={String(config.objective)} onChange={event => onChange({ ...trigger, configuration: { ...config, objective: event.target.value } })}><option value="resolution">Resolution</option><option value="response">First response</option></select></div>}
      {trigger.type !== 'ticket.sla_breached' && <>
        <div className="field"><label htmlFor="automation-duration">Duration</label><input id="automation-duration" className="input" type="number" min={1 / unit} max={525600 / unit} step="any" value={typeof config.durationMinutes === 'number' ? config.durationMinutes / unit : ''} aria-invalid={invalid || undefined} aria-describedby={`automation-time-help${invalid ? ' automation-trigger-error' : ''}`} onChange={event => onChange({ ...trigger, configuration: { ...config, durationMinutes: event.target.value === '' ? '' : Number(event.target.value) * unit } })}/></div>
        <div className="field"><label htmlFor="automation-duration-unit">Unit</label><select id="automation-duration-unit" className="input" value={unit} onChange={event => setUnit(Number(event.target.value))}><option value={1}>Minutes</option><option value={60}>Hours</option><option value={1440}>Days</option></select></div>
      </>}
    </div>
    <p className="muted" id="automation-time-help">{trigger.type === 'ticket.sla_breached' ? 'Uses the stored SLA deadline.' : 'Elapsed time, not business hours. Durations must equal whole minutes, from 1 minute to 365 days.'} Only future threshold crossings after enablement and processing activation qualify.</p>
    {trigger.type === 'ticket.open_duration_reached' && <p className="muted">Age starts at ticket creation. Reopening does not reset it; resolved and closed tickets are excluded.</p>}
    {['ticket.unassigned_duration_reached', 'ticket.waiting_on_user_duration_reached'].includes(trigger.type) && <p className="muted">Older tickets with an unknown start time become eligible only after leaving and entering this state again. Team assignment alone does not end an unassigned period.</p>}
  </div>;
}
