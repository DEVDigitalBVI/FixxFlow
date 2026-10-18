'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Timestamp } from '@/features/timezones/provider';
import { useUnsavedChanges } from '@/components/ui/unsaved-changes';
import { createClient } from '@/lib/supabase/client';
import type { RoomMessage } from './message-model';

export function EditableChatMessage({ message, conversationId, organizationId, canEdit, onSaved }: {
  message: RoomMessage; conversationId: string; organizationId: string; canEdit: boolean;
  onSaved?: (message: RoomMessage) => void;
}) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const [saved, setSaved] = useState<RoomMessage | null>(null);
  const current = saved && (saved.revision ?? 1) > (message.revision ?? 1) ? saved : message;
  const [edit, setEdit] = useState<{ body: string; original: RoomMessage } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const restoreFocus = useRef(false);
  useUnsavedChanges(Boolean(edit && (edit.body !== edit.original.body || pending)));
  const editing = Boolean(edit);
  useEffect(() => {
    if (editing) editor.current?.focus();
    else if (restoreFocus.current) { button.current?.focus(); restoreFocus.current = false; }
  }, [editing]);
  useEffect(() => { if (error) feedback.current?.focus(); }, [error]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit || inFlight.current || !canEdit) return;
    const body = edit.body.trim();
    if (!body || body.length > 20000) { setError('Enter a message of up to 20,000 characters.'); return; }
    if (body === edit.original.body) { restoreFocus.current = true; setEdit(null); return; }
    inFlight.current = true; setPending(true); setError('');
    try {
      const { data, error } = await supabase.rpc('edit_chat_message', {
        org: organizationId, conversation: conversationId, message: message.id,
        expected_revision: edit.original.revision ?? 1, new_body: body,
      });
      if (error) throw error;
      const updated = data?.[0];
      if (!updated) { setError('This message changed or the conversation closed. Your edit is still here. Cancel editing to review the latest version.'); router.refresh(); return; }
      setSaved(updated); onSaved?.(updated); restoreFocus.current = true; setEdit(null); router.refresh();
    } catch { setError('Changes could not be saved. Your edit is still here; try again.'); }
    finally { inFlight.current = false; setPending(false); }
  }

  return <div className="chat-message-content">
    <span className="sr-only" role="status">{saved && !editing ? "Message updated." : ""}</span>
    {edit ? <form className="chat-message-editor" onSubmit={save} aria-busy={pending}>
      <label htmlFor={`edit-${message.id}`}>Edit {message.kind === 'internal_note' ? 'internal note · IT only' : 'message'}</label>
      <textarea ref={editor} id={`edit-${message.id}`} className="input textarea" value={edit.body} maxLength={20000} required rows={3} disabled={pending} aria-describedby={`edit-hint-${message.id}${error ? ` edit-error-${message.id}` : ''}`} onChange={event => setEdit({ ...edit, body: event.target.value })} onKeyDown={event => {
        if (event.key === 'Escape' && !pending && !event.nativeEvent.isComposing) { event.preventDefault(); restoreFocus.current = true; setEdit(null); setError(''); }
      }}/>
      <p className="muted" id={`edit-hint-${message.id}`}>Enter adds a new line. Save changes to update your message.</p>
      {error && <p ref={feedback} id={`edit-error-${message.id}`} className="form-error" role="alert" tabIndex={-1}>{error}</p>}
      {!canEdit && <p role="status">This conversation is closed. Your edit has been kept so you can copy it.</p>}
      <div className="chat-message-edit-actions"><button className="button button-primary" disabled={pending || !canEdit || !edit.body.trim()}>{pending ? 'Saving…' : 'Save changes'}</button><button className="button button-secondary" type="button" disabled={pending} onClick={() => { restoreFocus.current = true; setEdit(null); setError(''); }}>Cancel editing</button></div>
    </form> : <><p>{current.body}</p><div className="chat-message-edit-meta">
      {current.edited_at && <small>Edited <time dateTime={current.edited_at}><Timestamp value={current.edited_at}/></time></small>}
      {canEdit && <button ref={button} className="button button-quiet chat-edit-button" type="button" aria-label={`Edit your ${message.kind === 'internal_note' ? 'internal note' : 'message'} from ${message.created_at}`} onClick={() => { setError(''); setEdit({ body: current.body, original: current }); }}>Edit</button>}
    </div></>}
  </div>;
}
