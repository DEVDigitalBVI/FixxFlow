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
  label,
  requestKey: initialRequestKey = '',
}: {
  ticketId: string;
  revision: number;
  operation: 'publish' | 'withdraw';
  children?: ReactNode;
  label?: string;
  requestKey?: string;
}) {
  const router = useRouter(),
    [version, setVersion] = useState(revision),
    [requestKey, setRequestKey] = useState(initialRequestKey),
    [failed, setFailed] = useState(false);
  return (
    <ActionForm
      className="stack"
      protectDraft={operation === 'publish'}
      action={async (form) => {
        const result = await manageServiceAnnouncement(form);
        setFailed(!!result.error);
        if (result.success) {
          setVersion(result.revision!);
          setRequestKey(crypto.randomUUID());
          router.refresh();
        }
        return result;
      }}
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="revision" value={version} />
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="requestKey" value={requestKey} />
      {children}
      <SubmitButton
        className={`button button-${operation === 'publish' ? 'primary' : 'secondary'}`}
        pendingLabel={operation === 'publish' ? 'Publishing…' : 'Removing…'}
      >
        {label ?? (operation === 'publish' ? 'Publish announcement' : 'Remove announcement')}
      </SubmitButton>
      {failed && (
        <a
          href={`/app/tickets/${ticketId}#employee-announcement`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Review latest announcement in a new tab
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
  update = false,
  requestKey,
}: {
  ticketId: string;
  revision: number;
  title: string;
  body: string;
  update?: boolean;
  requestKey: string;
}) {
  const id = useId();
  return (
    <AnnouncementForm
      ticketId={ticketId}
      revision={revision}
      operation="publish"
      requestKey={requestKey}
      label={update ? 'Publish update' : 'Publish announcement'}
    >
      <label className="field" htmlFor={`${id}-title`}>
        Title (required)
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
        Message (required)
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
      <p className="muted">Emails all active workspace members and appears on their home page.</p>
    </AnnouncementForm>
  );
}
