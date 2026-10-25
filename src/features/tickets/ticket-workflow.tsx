'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { TicketStatus } from '@/types/database';

const workflowSteps = [
  {
    title: 'Review request',
    hint: 'Understand what the requester needs and how the issue affects their work.',
    help: [
      <>Check the description, reported work impact and attached files.</>,
      <>
        Use <strong>Assign &amp; start</strong> to choose an owner and review the priority.
      </>,
      <>
        If information is missing, use <strong>Respond</strong> to ask the requester.
      </>,
    ],
    hash: 'ticket-review',
  },
  {
    title: 'Assign & start',
    hint: 'Choose an owner, confirm the priority, and begin work.',
    help: [
      <>
        Select <strong>Assign to me</strong> for an unassigned ticket, or choose an owner and save.
      </>,
      <>Check priority against the reported work impact.</>,
      <>
        Select <strong>Start work</strong> when troubleshooting begins.
      </>,
    ],
    hash: 'ticket-assignment',
  },
  {
    title: 'Coordinate',
    hint: '',
    help: [
      <>Apply a company procedure for checklists, approvals or scheduled updates.</>,
      <>Declare an incident when a wider disruption needs coordinated response.</>,
      <>
        Routine tickets can go straight to <strong>Respond</strong>.
      </>,
    ],
    hash: 'ticket-workflow-tools',
  },
  {
    title: 'Respond',
    hint: 'Ask a question, share an update, or record a private IT note.',
    help: [
      <>
        Read the conversation, then choose <strong>Reply to requester</strong> for a message they
        can see, or <strong>Internal note</strong> for troubleshooting visible only to IT staff.
      </>,
      <>
        Use the send or add button to save your message; sending a reply does not resolve the
        ticket.
      </>,
      <>Skip this step if no update is needed.</>,
    ],
    hash: 'ticket-conversation',
  },
  {
    title: 'Resolve',
    hint: 'Record the outcome and mark the ticket resolved when the issue is fixed.',
    help: [
      <>
        Use <strong>Respond</strong> to explain the fix to the requester.
      </>,
      <>
        Choose <strong>Resolved</strong> from <strong>Status</strong>, then select{' '}
        <strong>Save status</strong> when the issue is fixed.
      </>,
      <>
        If work is continuing, choose the appropriate work status instead. Moving to the next step
        does not resolve the ticket.
      </>,
    ],
    hash: 'ticket-resolution',
  },
  {
    title: 'Activity history',
    hint: 'See who changed this ticket, what changed and when.',
    help: [
      <>Review recent activity for ownership, status changes and recorded decisions.</>,
      <>Open the full history for older events.</>,
      <>To continue working, select the relevant step above.</>,
    ],
    hash: 'ticket-activity',
  },
];
const stepsWithoutCoordination = workflowSteps.filter(
  (step) => step.hash !== 'ticket-workflow-tools',
);
export function TicketWorkflow({
  status,
  assigned,
  review,
  assignment,
  conversation,
  resolution,
  tools,
  activeWorkflow,
  history,
}: {
  status: TicketStatus;
  assigned: boolean;
  review: ReactNode;
  assignment: ReactNode;
  conversation: ReactNode;
  resolution: ReactNode;
  tools: ReactNode;
  activeWorkflow: boolean;
  history: ReactNode;
}) {
  const steps = tools ? workflowSteps : stepsWithoutCoordination;
  const initialHash =
    status === 'resolved' || status === 'closed'
      ? 'ticket-resolution'
      : assigned
        ? status === 'new' || status === 'open'
          ? 'ticket-assignment'
          : 'ticket-conversation'
        : 'ticket-review';
  const initial = steps.findIndex((item) => item.hash === initialHash);
  const [step, setStep] = useState(initial);
  const headings = useRef<Array<HTMLHeadingElement | null>>([]);
  const focusNext = useRef(false);
  useEffect(() => {
    const followHash = () => {
      const hash = window.location.hash;
      const coordinationHashes = [
        '#ticket-procedures',
        '#incident-summary',
        '#response-checklist',
        '#incident-approvals',
        '#communication-plan',
      ];
      const index = coordinationHashes.includes(hash)
        ? steps.findIndex((s) => s.hash === 'ticket-workflow-tools')
        : hash === '#ticket-details'
          ? steps.findIndex((s) => s.hash === 'ticket-assignment')
          : steps.findIndex((s) => `#${s.hash}` === hash);
      if (index >= 0) {
        focusNext.current = true;
        setStep(index);
      }
    };
    followHash();
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, [steps]);
  useEffect(() => {
    if (focusNext.current) {
      headings.current[step]?.focus();
      focusNext.current = false;
    }
  }, [step]);
  const go = (index: number) => {
    if (index === step) return;
    focusNext.current = true;
    setStep(index);
    window.history.replaceState(window.history.state, '', `#${steps[index].hash}`);
  };
  const panels: Record<string, ReactNode> = {
    'ticket-review': review,
    'ticket-assignment': assignment,
    'ticket-workflow-tools': tools,
    'ticket-conversation': conversation,
    'ticket-resolution': resolution,
    'ticket-activity': history,
  };
  const hint = (item: (typeof workflowSteps)[number]) =>
    item.hash === 'ticket-workflow-tools'
      ? activeWorkflow
        ? 'This ticket has active coordination work. Review its checklist, approvals and stakeholder updates before continuing.'
        : 'Optional for routine tickets. Apply a company procedure or declare a wider incident here, or continue to Respond.'
      : item.hint;
  return (
    <div className="ticket-wizard">
      <nav aria-label="Ticket workflow">
        <ol className="ticket-wizard-steps">
          {steps.map((item, index) => (
            <li key={item.hash}>
              <button
                type="button"
                className={
                  item.hash === 'ticket-activity' ||
                  (item.hash === 'ticket-workflow-tools' && !activeWorkflow)
                    ? 'ticket-step-secondary'
                    : undefined
                }
                aria-current={step === index ? 'step' : undefined}
                onClick={() => go(index)}
              >
                <span className="ticket-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span>{item.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <p className="sr-only" role="status">
        Step {step + 1} of {steps.length} · {steps[step].title}
      </p>
      {steps.map((item, index) => (
        <section
          key={item.hash}
          id={item.hash}
          hidden={step !== index}
          aria-labelledby={`${item.hash}-heading`}
          className="ticket-wizard-panel"
        >
          <header className="ticket-step-heading">
            <h2
              id={`${item.hash}-heading`}
              ref={(node) => {
                headings.current[index] = node;
              }}
              tabIndex={-1}
            >
              {item.title}
            </h2>
            <p className="muted">{hint(item)}</p>
            <details className="ticket-step-help">
              <summary>
                <span className="ticket-guidance-show">Show guidance</span>
                <span className="ticket-guidance-hide">Hide guidance</span>
                <span className="sr-only">: {item.title}</span>
              </summary>
              <ol>
                {item.help.map((instruction, position) => (
                  <li key={position}>{instruction}</li>
                ))}
              </ol>
            </details>
          </header>
          <div className="ticket-step-content">{panels[item.hash]}</div>
        </section>
      ))}
      <div className="ticket-wizard-footer">
        <p className="muted ticket-navigation-note">
          Jump to any step. Back and Next only change the view; use each action’s button to save
          changes.
        </p>
        <div className="ticket-wizard-navigation">
          {step > 0 ? (
            <button type="button" className="button button-secondary" onClick={() => go(step - 1)}>
              Back: {steps[step - 1].title}
            </button>
          ) : (
            <span />
          )}
          {step < steps.length - 1 ? (
            <button type="button" className="button button-primary" onClick={() => go(step + 1)}>
              Next: {steps[step + 1].title}
            </button>
          ) : (
            <p className="muted">
              {status === 'resolved' || status === 'closed'
                ? 'This ticket is resolved. You can review any step or return to the queue.'
                : 'Return to Resolve to update the ticket status, or review any earlier step.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
