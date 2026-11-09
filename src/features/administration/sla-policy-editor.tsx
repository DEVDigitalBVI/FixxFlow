'use client';

import { useState } from 'react';

import { ActionForm } from '@/components/ui/action-form';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { elapsedLabel } from '@/features/reporting/chart-model';
import {
  scheduleTime,
  slaDays,
  type OrganizationSlaPolicy,
} from '@/features/tickets/organization-sla';
import { fixedSlaTargets } from '@/features/tickets/sla-policy';
import { TicketStatusBadge } from '@/features/tickets/ticket-status-badge';

import { saveSlaPolicy } from './sla-actions';

export function SlaPolicyEditor({
  policy,
  timeZone,
}: {
  policy: OrganizationSlaPolicy;
  timeZone: string;
}) {
  const [version, setVersion] = useState(policy.version);
  const [targets, setTargets] = useState(policy.targets);
  const save = async (form: FormData) => {
    const result = await saveSlaPolicy(form);
    if (result.success && result.version !== undefined) setVersion(result.version);
    return result;
  };
  return (
    <ActionForm action={save} className="sla-policy-editor stack">
      <input type="hidden" name="version" value={version} />
      <fieldset className="sla-schedule stack">
        <legend>Working hours</legend>
        <p className="muted">
          One opening and closing time applies to every selected day, in {timeZone}. Both clocks
          stop outside this schedule.
        </p>
        <div className="sla-working-days" role="group" aria-label="Working days">
          {slaDays.map((label, index) => (
            <label key={label}>
              <Checkbox
                name="days"
                value={index + 1}
                defaultChecked={policy.schedule.days.includes(index + 1)}
              />
              {label}
            </label>
          ))}
        </div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sla-opens">Opens at</label>
            <Input
              id="sla-opens"
              name="opens"
              type="time"
              required
              defaultValue={scheduleTime(policy.schedule.opens)}
            />
          </div>
          <div className="field">
            <label htmlFor="sla-closes">Closes at</label>
            <Input
              id="sla-closes"
              name="closes"
              type="time"
              required
              defaultValue={scheduleTime(policy.schedule.closes)}
              aria-describedby="sla-midnight"
            />
          </div>
        </div>
        <p id="sla-midnight" className="muted">
          One daily window applies to all selected days. Closing at 00:00 means midnight at the end
          of the day; 00:00–00:00 provides 24-hour coverage.
        </p>
      </fieldset>
      <fieldset className="sla-targets stack">
        <legend>Targets by priority</legend>
        <p className="muted" id="sla-target-unit">
          Enter whole support minutes. 1 hour = 60 minutes; 24 hours = 1,440 minutes. Resolution
          must be at least as long as first response.
        </p>
        {fixedSlaTargets.map(({ priority }) => (
          <fieldset className="sla-priority-row" key={priority}>
            <legend>
              <TicketStatusBadge priority={priority} />
            </legend>
            <div className="form-grid">
              {(['response', 'resolution'] as const).map((objective) => (
                <div className="field" key={objective}>
                  <label htmlFor={`sla-${priority}-${objective}`}>
                    {objective === 'response' ? 'First response' : 'Resolution'} (minutes)
                  </label>
                  <Input
                    id={`sla-${priority}-${objective}`}
                    name={`${priority}-${objective}`}
                    type="number"
                    min={1}
                    max={525600}
                    step={1}
                    required
                    defaultValue={policy.targets[priority][objective]}
                    onChange={(event) =>
                      setTargets((current) => ({
                        ...current,
                        [priority]: {
                          ...current[priority],
                          [objective]: Number(event.target.value),
                        },
                      }))
                    }
                    aria-describedby={`sla-target-unit sla-equivalent-${priority}-${objective}`}
                  />
                  <span
                    id={`sla-equivalent-${priority}-${objective}`}
                    className="muted"
                    role="status"
                  >
                    {Number.isFinite(targets[priority][objective]) &&
                    targets[priority][objective] > 0
                      ? `${elapsedLabel(targets[priority][objective])} of support time`
                      : 'Enter a positive whole number of minutes.'}
                  </span>
                </div>
              ))}
            </div>
          </fieldset>
        ))}
      </fieldset>
      <p className="muted">
        Changes apply to new tickets. Existing tickets keep their original targets, working days and
        hours, including when priority changes or work resumes. Waiting on user pauses only
        resolution. Documented holds also pause resolution and require an owner and follow-up date.
        Existing breaches are preserved.
      </p>
      <SubmitButton pendingLabel="Saving SLA standards…">Save SLA standards</SubmitButton>
    </ActionForm>
  );
}
