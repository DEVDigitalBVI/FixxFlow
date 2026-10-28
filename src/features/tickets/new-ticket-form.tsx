'use client';

import { createContext, use, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { ActionForm } from '@/components/ui/action-form';
import type { ActionResult } from '@/lib/action-result';
import { attachmentTypes, validAttachment } from '@/lib/uploads';

import { uploadTicketAttachment } from './attachment-upload';

export const MAX_INITIAL_FILES = 5;

type Picked = { files: File[]; setFiles: (files: File[]) => void };
const PickedFiles = createContext<Picked | null>(null);

/** The ticket id from a creation redirect such as /app/tickets/<id>?success=… */
export function createdTicketId(redirectTo: string) {
  const match = /^\/app\/tickets\/([^/?#]+)/.exec(redirectTo);
  return match && match[1] !== 'new' ? decodeURIComponent(match[1]) : null;
}

/** Appends a note about files that did not upload to the success message. */
export function withUploadNote(redirectTo: string, failed: string[]) {
  if (!failed.length) return redirectTo;
  const url = new URL(redirectTo, 'https://fixxflow.invalid');
  const note =
    failed.length === 1
      ? `${failed[0]} could not be attached. Add it again below.`
      : `${failed.length} files could not be attached (${failed.join(', ')}). Add them again below.`;
  url.searchParams.set('success', `${url.searchParams.get('success') ?? ''} ${note}`.trim());
  return url.pathname + url.search;
}

/**
 * Ticket creation form that also sends files chosen before submitting. Files upload
 * directly to storage after the ticket exists, so they never pass through the action.
 */
export function NewTicketForm({
  action,
  className,
  organizationId,
  userId,
  children,
}: {
  action: (data: FormData) => Promise<ActionResult>;
  className?: string;
  organizationId: string;
  userId: string;
  children: ReactNode;
}) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <PickedFiles value={{ files, setFiles }}>
      <ActionForm
        action={action}
        className={className}
        beforeRedirect={async (redirectTo) => {
          const ticketId = createdTicketId(redirectTo);
          if (!ticketId || !files.length) return;
          const failed: string[] = [];
          for (const file of files) {
            const result = await uploadTicketAttachment({
              organizationId,
              ticketId,
              userId,
              file,
            }).catch(() => 'upload-failed' as const);
            if (result !== 'saved') failed.push(file.name);
          }
          return withUploadNote(redirectTo, failed);
        }}
      >
        {children}
      </ActionForm>
    </PickedFiles>
  );
}

/** Optional screenshots and files, sent once the request is created. */
export function InitialAttachmentsField({ staff = false }: { staff?: boolean }) {
  const picked = use(PickedFiles);
  const hint = useId();
  const [message, setMessage] = useState('');
  // After a removal, focus the next Remove button, or Add files when none remain.
  const focusAfterRemove = useRef<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null) return;
    focusAfterRemove.current = null;
    const buttons = listRef.current?.querySelectorAll('button');
    const next = buttons?.length ? buttons[Math.min(index, buttons.length - 1)] : null;
    (next ?? inputRef.current)?.focus();
  });
  if (!picked) return null;
  const { files, setFiles } = picked;
  return (
    <div className="field initial-attachments">
      <span className="initial-attachments-label">Screenshots or files (optional)</span>
      <p id={hint} className="muted">
        Up to {MAX_INITIAL_FILES} files, 10 MB each: images, PDF, text, Word or Excel. Files are
        visible to {staff ? 'the requester and IT staff' : 'you and IT support'}.
      </p>
      <label className="button button-secondary initial-attachments-pick">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={attachmentTypes.join(',')}
          aria-describedby={hint}
          disabled={files.length >= MAX_INITIAL_FILES}
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = '';
            const valid = chosen.filter(validAttachment);
            const room = MAX_INITIAL_FILES - files.length;
            const added = valid.slice(0, room);
            setFiles([...files, ...added]);
            setMessage(
              valid.length < chosen.length
                ? 'Some files were skipped. Use a nonempty image, PDF, text, Word, or Excel file up to 10 MB.'
                : added.length < valid.length
                  ? `Only ${MAX_INITIAL_FILES} files can be added now. Add more after submitting.`
                  : '',
            );
          }}
        />
        Add files
      </label>
      {files.length > 0 && (
        <ul ref={listRef} className="initial-attachments-list" aria-label="Files to attach">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <span>
                {file.name} · {Math.ceil(file.size / 1024)} KB
              </span>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  setFiles(files.filter((_, i) => i !== index));
                  setMessage('');
                  focusAfterRemove.current = index;
                }}
              >
                Remove<span className="sr-only"> {file.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted" role="status">
        {message}
      </p>
    </div>
  );
}
