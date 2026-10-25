import { workflowKinds, type WorkflowDefinition } from './model';

export function DefinitionPreview({ definition }: { definition: WorkflowDefinition }) {
  return (
    <div className="stack workflow-definition">
      <p className="muted">
        {workflowKinds[definition.kind]} · {definition.steps.length} response steps
      </p>
      <p className="ticket-description">{definition.description || 'No description provided.'}</p>
      <ol className="response-checklist">
        {definition.steps.map((step, index) => (
          <li className="stack" key={step.id}>
            <h3>
              {index + 1}. {step.title}
            </h3>
            {step.instructions && <p className="ticket-description">{step.instructions}</p>}
            <p className="muted">
              Assigned to {step.assignee === 'backup' ? 'backup coordinator' : 'coordinator'} ·{' '}
              {step.due_minutes
                ? `Due ${step.due_minutes} minutes after application`
                : 'No step deadline'}
              {step.approval_required
                ? ` · Approval required, decision due after ${step.approval_minutes} minutes`
                : ''}
            </p>
          </li>
        ))}
      </ol>
      <h3>Communication</h3>
      <p className="ticket-description">
        {definition.communication.guidance ||
          'Add communication guidance within the ticket as needed.'}
      </p>
      <p className="muted">
        {definition.communication.next_update_minutes
          ? `First update reminder after ${definition.communication.next_update_minutes} minutes`
          : 'No initial update reminder'}{' '}
        ·{' '}
        {definition.communication.group_names.length
          ? `Stakeholder groups: ${definition.communication.group_names.join(', ')}`
          : 'No predefined stakeholder groups'}
      </p>
      <h3>Escalation defaults</h3>
      <p className="muted">
        {definition.escalation.enabled
          ? 'Response and communication escalation enabled'
          : 'Response and communication escalation disabled'}{' '}
        · Acknowledgement {definition.escalation.acknowledgement_minutes} minutes · Overdue grace{' '}
        {definition.escalation.overdue_minutes} minutes
      </p>
      <p className="muted">
        Deadlines use calendar minutes from application. Existing ticket communication and
        escalation settings are preserved. Applying never sends stakeholder messages automatically.
      </p>
    </div>
  );
}
