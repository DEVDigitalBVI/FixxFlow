'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type ReactNode } from 'react';

import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';

import { manageServiceAnnouncement } from './service-announcement-actions';

export function AnnouncementForm({
  ticketId,
  revision,
  operation,
  children,
}: {
  ticketId: string;
  revision: number;
  operation: 'save' | 'publish' | 'withdraw';
  children: ReactNode;
}) {
  const router = useRouter(),
    [version, setVersion] = useState(revision),
    [failed, setFailed] = useState(false);
  return (
    <ActionForm
      className="stack"
      protectDraft={operation === 'save'}
      action={async (form) => {
        const result = await manageServiceAnnouncement(form);
        setFailed(!!result.error);
        if (result.success) {
          setVersion(result.revision!);
          router.refresh();
        }
        return result;
      }}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="revision" value={operation === 'save' ? version : revision} />
      <input type="hidden" name="operation" value={operation} />
      {children}
      <SubmitButton
        className={`button button-${operation === 'publish' ? 'primary' : 'secondary'}`}
        pendingLabel={operation === 'publish' ? 'Publishing…' : 'Saving…'}
      >
        {operation === 'save'
          ? 'Save announcement draft'
          : operation === 'publish'
            ? 'Publish to everyone'
            : 'Remove announcement'}
      </SubmitButton>
      {failed && (
        <a
          href={`/app/tickets/${ticketId}#communication-plan`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Review latest coordination in a new tab
        </a>
      )}
    </ActionForm>
  );
}
export function AnnouncementEditor({
  ticketId,
  revision,
  title,
  body,
}: {
  ticketId: string;
  revision: number;
  title: string;
  body: string;
}) {
  const id = useId();
  return (
    <AnnouncementForm ticketId={ticketId} revision={revision} operation="save">
      <label className="field" htmlFor={`${id}-title`}>
        Announcement title (required)
        <input
          className="input"
          id={`${id}-title`}
          name="title"
          required
          minLength={3}
          maxLength={180}
          defaultValue={title}
        />
      </label>
      <label className="field" htmlFor={`${id}-body`}>
        Message for everyone (required)
        <textarea
          className="input"
          id={`${id}-body`}
          name="body"
          required
          minLength={3}
          maxLength={3000}
          rows={5}
          defaultValue={body}
        />
      </label>
      <p className="muted">
        Only this saved title and message will be shared. Leave out internal troubleshooting, names
        and private details. Saving does not replace the current notice.
      </p>
    </AnnouncementForm>
  );
}
