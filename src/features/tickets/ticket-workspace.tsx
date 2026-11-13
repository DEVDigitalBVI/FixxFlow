'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { observeTicketHash } from './ticket-workflow';

export function TicketWorkspace({
  review,
  assignment,
  conversation,
  resolution,
  tools,
  coordinationSection,
  activeWorkflow,
  history,
  details,
  files,
}: {
  review: ReactNode;
  assignment: ReactNode;
  conversation: ReactNode;
  resolution: ReactNode;
  tools?: ReactNode;
  coordinationSection?: ReactNode;
  activeWorkflow?: boolean;
  history: ReactNode;
  details?: ReactNode;
  files?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return root.current ? observeTicketHash(root.current, window, document) : undefined;
  }, []);
  return (
    <div ref={root} className="ticket-workspace">
      <div className="ticket-workspace-action-slot">
        <div className="ticket-workspace-actions" id="ticket-status" tabIndex={-1}>
          {assignment}
        </div>
      </div>
      <div className="ticket-workspace-main">
        <div className="ticket-workspace-request" id="ticket-review" tabIndex={-1}>
          {review}
        </div>
        <div className="ticket-workspace-conversation" id="ticket-conversation" tabIndex={-1}>
          {conversation}
        </div>
      </div>
      <aside className="ticket-workspace-details" aria-label="Ticket details">
        {details}
        <details className="ticket-disclosure" id="ticket-resolution">
          <summary>Service levels</summary>
          {resolution}
        </details>
      </aside>
      <div className="ticket-workspace-secondary">
        {coordinationSection ??
          (tools && (
            <details
              className="ticket-disclosure"
              id="ticket-workflow-tools"
              open={activeWorkflow || undefined}
            >
              <summary>Coordination{activeWorkflow ? ' · Active' : ''}</summary>
              {tools}
            </details>
          ))}
        <details className="ticket-disclosure" id="ticket-activity">
          <summary>Activity</summary>
          {history}
        </details>
        <details className="ticket-disclosure" id="ticket-files">
          <summary>Files</summary>
          {files}
        </details>
      </div>
    </div>
  );
}
