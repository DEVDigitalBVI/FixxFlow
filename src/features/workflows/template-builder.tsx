'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import { confirmDiscardChanges, useUnsavedChanges } from '@/components/ui/unsaved-changes';

import { manageWorkflowTemplate } from './actions';
import {
  newProcedureStep,
  workflowKindDescriptions,
  workflowKinds,
  type ProcedureStep,
  type WorkflowDefinition,
} from './model';

export function TemplateBuilder({
  templateId,
  revision,
  initial,
}: {
  templateId: string;
  revision: number;
  initial: WorkflowDefinition;
}) {
  const id = useId(),
    [draft, setDraft] = useState(initial),
    [version, setVersion] = useState(revision),
    [groups, setGroups] = useState(initial.communication.group_names.join('\n')),
    [failed, setFailed] = useState(false),
    [announcement, setAnnouncement] = useState('');
  const normalized = {
    ...draft,
    communication: {
      ...draft.communication,
      group_names: groups
        .split(/\r?\n/)
        .map((n) => n.trim())
        .filter(Boolean),
    },
  };
  const serialized = JSON.stringify(normalized),
    [saved, setSaved] = useState(JSON.stringify(initial));
  const effectiveRevision =
    JSON.stringify(initial) === saved ? Math.max(version, revision) : version;
  const release = useUnsavedChanges(serialized !== saved),
    focusStep = useRef<string | null>(null);
  useEffect(() => {
    if (focusStep.current) {
      document.getElementById(`${id}-${focusStep.current}-title`)?.focus();
      focusStep.current = null;
    }
  }, [draft.steps, id]);
  const changeStep = (key: string, patch: Partial<ProcedureStep>) =>
    setDraft((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === key ? { ...s, ...patch } : s)),
    }));
  const move = (index: number, delta: number) => {
    focusStep.current = draft.steps[index].id;
    setDraft((prev) => {
      const steps = [...prev.steps];
      [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]];
      return { ...prev, steps };
    });
    setAnnouncement(`Step moved to position ${index + delta + 1}.`);
  };
  const number = (value: string) => (value === '' ? null : Number(value));
  return (
    <ActionForm
      className="stack workflow-builder"
      action={async (form) => {
        const result = await manageWorkflowTemplate(form);
        setFailed(Boolean(result.error));
        if (result.success) {
          release();
          setSaved(serialized);
          setVersion(result.revision!);
        }
        return result;
      }}
    >
      <input type="hidden" name="templateId" value={templateId} />
      <input type="hidden" name="operation" value="save" />
      <input type="hidden" name="revision" value={effectiveRevision} />
      <input type="hidden" name="definition" value={serialized} />
      <div className="workflow-builder-intro">
        <h2>A repeatable checklist for your team</h2>
        <p>Create the steps once. Staff apply a published version to a ticket when they need it.</p>
        <p className="muted">
          <strong>Example:</strong> “Restore office Wi-Fi”: check the outage, restart equipment,
          confirm recovery.
        </p>
      </div>
      <section className="stack workflow-builder-section" aria-labelledby={`${id}-basics`}>
        <div>
          <h2 id={`${id}-basics`}>1. Describe the procedure</h2>
          <p className="muted">
            Give staff a clear name and explain when to use it. Required fields are marked *.
          </p>
        </div>
        <label className="field" htmlFor={`${id}-name`}>
          Procedure name *
          <input
            placeholder="e.g. Restore office Wi-Fi"
            className="input"
            id={`${id}-name`}
            required
            minLength={3}
            maxLength={100}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="field" htmlFor={`${id}-kind`}>
          Use this procedure for *
          <select
            className="input"
            id={`${id}-kind`}
            aria-describedby={`${id}-kind-help`}
            value={draft.kind}
            onChange={(e) =>
              setDraft({ ...draft, kind: e.target.value as WorkflowDefinition['kind'] })
            }
          >
            {Object.entries(workflowKinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted" id={`${id}-kind-help`}>
          {workflowKindDescriptions[draft.kind]}
        </p>
        <label className="field" htmlFor={`${id}-description`}>
          When should staff use this? (optional)
          <textarea
            className="input"
            id={`${id}-description`}
            placeholder="e.g. Use when several people in an office cannot connect to Wi-Fi."
            rows={3}
            maxLength={2000}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
      </section>
      <section className="stack workflow-builder-section" aria-labelledby={`${id}-checklist`}>
        <div className="section-heading-row">
          <h2 id={`${id}-checklist`}>2. Build the checklist</h2>
          <span className="muted">{draft.steps.length} of 20 steps</span>
        </div>
        <p className="muted">
          List the actions in the order staff should follow. The coordinator is the person leading
          this procedure on a ticket; staff choose that person when they apply it.
        </p>
        <span role="status" className="muted">
          {announcement}
        </span>
        {draft.steps.map((step, index) => (
          <fieldset className="stack incident-fields" key={step.id}>
            <legend>Step {index + 1}</legend>
            <label className="field" htmlFor={`${id}-${step.id}-title`}>
              What needs to be done? *
              <input
                placeholder="e.g. Confirm which areas are affected"
                className="input"
                id={`${id}-${step.id}-title`}
                required
                minLength={3}
                maxLength={180}
                value={step.title}
                onChange={(e) => changeStep(step.id, { title: e.target.value })}
              />
            </label>
            <label className="field" htmlFor={`${id}-${step.id}-instructions`}>
              How to do it (optional)
              <textarea
                placeholder="Add checks, useful details and what a successful result looks like."
                className="input"
                id={`${id}-${step.id}-instructions`}
                maxLength={4000}
                rows={3}
                value={step.instructions}
                onChange={(e) => changeStep(step.id, { instructions: e.target.value })}
              />
            </label>
            <details className="workflow-builder-options">
              <summary>
                Assignment, deadline &amp; approval
                <span className="disclosure-summary">
                  {step.assignee === 'backup' ? 'Backup coordinator' : 'Coordinator'} ·{' '}
                  {step.due_minutes ? `Due after ${step.due_minutes} minutes` : 'No deadline'} ·{' '}
                  {step.approval_required ? 'Approval required' : 'No approval required'}
                </span>
              </summary>
              <div className="stack">
                <p className="muted">
                  By default, the coordinator carries out this step with no deadline or approval
                  required.
                </p>
                <label className="field" htmlFor={`${id}-${step.id}-assignee`}>
                  Who carries out this step?
                  <select
                    className="input"
                    id={`${id}-${step.id}-assignee`}
                    value={step.assignee}
                    onChange={(e) =>
                      changeStep(step.id, { assignee: e.target.value as ProcedureStep['assignee'] })
                    }
                  >
                    <option value="owner">Coordinator</option>
                    <option value="backup">Backup coordinator</option>
                  </select>
                </label>
                <label className="field" htmlFor={`${id}-${step.id}-due`}>
                  Complete within (minutes, optional)
                  <input
                    className="input"
                    id={`${id}-${step.id}-due`}
                    aria-describedby={`${id}-${step.id}-timing`}
                    type="number"
                    min={1}
                    max={43200}
                    value={step.due_minutes ?? ''}
                    onChange={(e) => changeStep(step.id, { due_minutes: number(e.target.value) })}
                  />
                </label>
                <p className="muted" id={`${id}-${step.id}-timing`}>
                  Time starts when the procedure is added to a ticket, not when this step begins.
                  For example, 60 means one hour after adding it. Nights and weekends count. Leave
                  blank for no deadline.
                </p>
                <label className="communication-choice">
                  <input
                    type="checkbox"
                    checked={step.approval_required}
                    onChange={(e) =>
                      changeStep(step.id, {
                        approval_required: e.target.checked,
                        approval_minutes: step.approval_minutes ?? 60,
                      })
                    }
                  />
                  <span>Require approval before marking this step complete</span>
                </label>
                {step.approval_required && (
                  <label className="field" htmlFor={`${id}-${step.id}-approval`}>
                    Approval due within (minutes of adding the procedure) *
                    <input
                      className="input"
                      id={`${id}-${step.id}-approval`}
                      type="number"
                      required
                      min={1}
                      max={43200}
                      value={step.approval_minutes ?? ''}
                      onChange={(e) =>
                        changeStep(step.id, { approval_minutes: number(e.target.value) })
                      }
                    />
                  </label>
                )}
                <p className="muted">
                  If approval is required, staff choose an approver when applying the procedure. A
                  decision is required before this step can be completed.
                </p>
              </div>
            </details>
            <div className="workflow-builder-actions">
              <button
                className="button button-quiet"
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move step ${index + 1} up`}
              >
                Move up
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={index === draft.steps.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move step ${index + 1} down`}
              >
                Move down
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={draft.steps.length === 1}
                onClick={() => {
                  if (window.confirm(`Remove step ${index + 1} from this draft?`)) {
                    focusStep.current = draft.steps[index ? index - 1 : 1].id;
                    setDraft({ ...draft, steps: draft.steps.filter((s) => s.id !== step.id) });
                    setAnnouncement('Draft step removed.');
                  }
                }}
                aria-label={`Remove step ${index + 1}`}
              >
                Remove step
              </button>
            </div>
          </fieldset>
        ))}
        <button
          className="button button-secondary"
          type="button"
          disabled={draft.steps.length >= 20}
          onClick={() => {
            const step = newProcedureStep();
            focusStep.current = step.id;
            setDraft({ ...draft, steps: [...draft.steps, step] });
            setAnnouncement('Step added.');
          }}
        >
          Add response step
        </button>
      </section>
      <section className="stack workflow-builder-section" aria-labelledby={`${id}-optional`}>
        <div>
          <h2 id={`${id}-optional`}>3. Add optional coordination</h2>
          <p className="muted">For a simple checklist, skip these settings and save your draft.</p>
        </div>
        <details className="workflow-builder-options">
          <summary>Updates &amp; audiences (optional)</summary>
          <div className="stack">
            <p className="muted">
              Explain who needs updates and what those updates should cover. Staff add recipients
              and approve messages on the ticket before sending.
            </p>
            <label className="field" htmlFor={`${id}-groups`}>
              Audience group names (optional)
              <textarea
                placeholder="e.g. Office managers"
                className="input"
                id={`${id}-groups`}
                rows={3}
                maxLength={1020}
                value={groups}
                onChange={(e) => setGroups(e.target.value)}
              />
            </label>
            <p className="muted">
              One name per line, up to 10. Applying creates empty groups where needed. Staff add
              company members before preparing an approved update.
            </p>
            <label className="field" htmlFor={`${id}-guidance`}>
              What should staff communicate? (optional)
              <textarea
                placeholder="e.g. Share the affected areas, expected recovery time and next update time."
                className="input"
                id={`${id}-guidance`}
                rows={4}
                maxLength={4000}
                value={draft.communication.guidance}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    communication: { ...draft.communication, guidance: e.target.value },
                  })
                }
              />
            </label>
            <label className="field" htmlFor={`${id}-reminder`}>
              Remind staff to send the first update after (minutes, optional)
              <input
                className="input"
                id={`${id}-reminder`}
                type="number"
                min={1}
                max={43200}
                value={draft.communication.next_update_minutes ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    communication: {
                      ...draft.communication,
                      next_update_minutes: number(e.target.value),
                    },
                  })
                }
              />
            </label>
          </div>
        </details>
        <details className="workflow-builder-options">
          <summary>Alerts for missed work (optional)</summary>
          <div className="stack">
            <p className="muted">
              Notify the backup coordinator when work is not acknowledged or deadlines are missed.
              Staff choose a backup when applying a procedure with alerts enabled.
            </p>
            <label className="communication-choice">
              <input
                type="checkbox"
                checked={draft.escalation.enabled}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    escalation: { ...draft.escalation, enabled: e.target.checked },
                  })
                }
              />
              <span>Alert the backup coordinator about missed work or updates</span>
            </label>
            <label className="field" htmlFor={`${id}-ack`}>
              Time allowed to acknowledge assigned work (minutes) *
              <input
                className="input"
                id={`${id}-ack`}
                type="number"
                min={1}
                max={1440}
                required
                value={draft.escalation.acknowledgement_minutes}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    escalation: {
                      ...draft.escalation,
                      acknowledgement_minutes: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label className="field" htmlFor={`${id}-grace`}>
              Wait after a missed deadline before alerting (minutes) *
              <input
                className="input"
                id={`${id}-grace`}
                type="number"
                min={0}
                max={1440}
                required
                value={draft.escalation.overdue_minutes}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    escalation: { ...draft.escalation, overdue_minutes: Number(e.target.value) },
                  })
                }
              />
            </label>
            <p className="muted">
              Existing ticket escalation and communication settings are preserved when another
              procedure is applied.
            </p>
          </div>
        </details>
      </section>
      <div className="workflow-builder-save">
        <h2>Save, review, then publish</h2>
        <p className="muted">
          Saving keeps this as a draft. Next, review the saved procedure and publish it so staff can
          use it on tickets.
        </p>
        <SubmitButton className="button button-primary" pendingLabel="Saving draft…">
          Save procedure draft
        </SubmitButton>
      </div>
      {failed && (
        <div className="stack">
          <a
            className="button button-secondary"
            href={`/app/administration/workflows/${templateId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Review saved template (opens in a new tab)
          </a>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              if (confirmDiscardChanges(true)) window.location.reload();
            }}
          >
            Reload saved draft
          </button>
        </div>
      )}
    </ActionForm>
  );
}
