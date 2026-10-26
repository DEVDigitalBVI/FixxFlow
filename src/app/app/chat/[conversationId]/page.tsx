import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ActionForm } from '@/components/ui/action-form';
import { Avatar } from '@/components/ui/avatar';
import { SubmitButton } from '@/components/ui/submit-button';
import { ChatCenter } from '@/features/chat/chat-center';
import { ChatInbox } from '@/features/chat/chat-inbox';
import { ChatRoom } from '@/features/chat/chat-room';
import { loadChatInbox } from '@/features/chat/inbox-data';
import { chatInboxHref, normalizeChatView } from '@/features/chat/inbox-model';
import { HISTORY_PAGE_SIZE, recentMessages } from '@/features/conversations/history';
import { profileLabels } from '@/features/lookups/labels';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';

import { assignChat, closeChat, convertChatToTicket, linkChatToTicket } from '../actions';

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ error?: string; success?: string; view?: string }>;
}) {
  const viewer = await requireViewer();
  const { conversationId } = await params;
  const notice = await searchParams;
  const supabase = await createClient();
  const { data: conversation, error: conversationError } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('organization_id', viewer.organizationId)
    .eq('id', conversationId)
    .maybeSingle();
  if (conversationError) throw new Error('Conversation could not be loaded. Please try again.');
  if (!conversation || (viewer.role === 'end_user' && conversation.requester_id !== viewer.id))
    notFound();
  const worker = viewer.role !== 'end_user';
  const view = normalizeChatView(notice.view);
  const readThrough = new Date().toISOString();
  const [messagesR, attachmentsR, ticketsR, inbox, savedRepliesR] = await Promise.all([
    supabase
      .from('chat_messages')
      .select('id, author_id, kind, body, created_at, revision, edited_at')
      .eq('organization_id', viewer.organizationId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(HISTORY_PAGE_SIZE),
    supabase
      .from('chat_attachments')
      .select('id, file_name, size_bytes, created_at, storage_path, content_type, uploaded_by')
      .eq('organization_id', viewer.organizationId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(HISTORY_PAGE_SIZE),
    worker && !conversation.ticket_id
      ? supabase
          .from('tickets')
          .select('id, ticket_number, title')
          .eq('organization_id', viewer.organizationId)
          .eq('requester_id', conversation.requester_id)
          .order('updated_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    loadChatInbox(supabase, viewer, view),
    worker
      ? supabase
          .from('saved_replies')
          .select('id, title, body')
          .eq('organization_id', viewer.organizationId)
          .order('title')
          .order('id')
          .limit(200)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const profiles = await profileLabels(supabase, viewer.organizationId, [
    conversation.requester_id,
    conversation.assigned_technician_id,
    ...(messagesR.data ?? []).map((row) => row.author_id),
    ...(attachmentsR.data ?? []).map((row) => row.uploaded_by),
  ]);
  const names = Object.fromEntries(
    profiles.map((profile) => [profile.user_id, profile.display_name]),
  );
  const paths = (attachmentsR.data ?? []).map((file) => file.storage_path);
  const { data: signed } = paths.length
    ? await supabase.storage.from('chat-attachments').createSignedUrls(paths, 3600)
    : { data: [] };
  const urls = new Map((signed ?? []).map((file) => [file.path, file.signedUrl ?? undefined]));
  const attachments = (attachmentsR.data ?? []).map((file) => ({
    ...file,
    url: urls.get(file.storage_path),
  }));
  const lastSupportReply = recentMessages(messagesR.data ?? []).findLast(
    (message) => message.kind === 'message' && message.author_id !== conversation.requester_id,
  );
  const supportId = conversation.assigned_technician_id ?? lastSupportReply?.author_id;
  const supportName = supportId ? (names[supportId] ?? 'IT support team') : 'IT support team';
  const person = worker ? (names[conversation.requester_id] ?? 'Employee') : supportName;
  return (
    <ChatCenter
      personal={!worker}
      inbox={
        <ChatInbox
          {...inbox}
          view={view}
          organizationId={viewer.organizationId}
          viewerId={viewer.id}
          personal={!worker}
          selectedId={conversation.id}
        />
      }
    >
      <section className="chat-active" aria-labelledby="chat-active-title">
        <header className="chat-active-header">
          <Link className="button button-quiet chat-back" href={chatInboxHref(view)}>
            ← {worker ? 'Inbox' : 'My chats'}
          </Link>
          <Avatar name={person} />
          <div className="chat-active-identity">
            <h2 id="chat-active-title">{conversation.topic}</h2>
            <p>
              {worker ? person : `Chatting with ${person}`}{' '}
              <span>· {conversation.status === 'open' ? 'Open' : 'Closed'}</span>
            </p>
            {!worker && conversation.status === 'open' && (
              <p>
                {conversation.assigned_technician_id
                  ? 'Your assigned technician can reply here.'
                  : lastSupportReply
                    ? `IT support · Last replied by ${supportName}.`
                    : 'Your conversation is in the IT support inbox. A technician has not picked it up yet.'}
              </p>
            )}
          </div>
        </header>
        {worker && (
          <details className="chat-context">
            <summary>Details</summary>
            <div className="chat-context-content">
              <h3>Conversation details</h3>
              <div className="chat-contact">
                <Avatar name={person} />
                <strong>{person}</strong>
                <span>Employee</span>
              </div>
              <dl className="chat-context-facts">
                <div>
                  <dt>Status</dt>
                  <dd>{conversation.status === 'open' ? 'Open' : 'Closed'}</dd>
                </div>
                <div>
                  <dt>Assigned to</dt>
                  <dd>
                    {conversation.assigned_technician_id
                      ? (names[conversation.assigned_technician_id] ?? 'IT support')
                      : 'Unassigned'}
                  </dd>
                </div>
              </dl>
              {conversation.ticket_id && (
                <Link
                  className="button button-secondary"
                  href={`/app/tickets/${conversation.ticket_id}`}
                >
                  View linked ticket
                </Link>
              )}
              <h3>Conversation tools</h3>
              <ActionForm action={assignChat} className="chat-control-form">
                <input type="hidden" name="conversationId" value={conversation.id} />
                <LookupSelect
                  resource="technicians"
                  name="assigneeId"
                  label="Assigned technician"
                  defaultValue={conversation.assigned_technician_id ?? ''}
                />
                <SubmitButton className="button button-secondary">Save assignment</SubmitButton>
              </ActionForm>
              {!conversation.ticket_id ? (
                <>
                  <form action={convertChatToTicket} className="chat-control-form">
                    <input type="hidden" name="conversationId" value={conversation.id} />
                    <SubmitButton className="button button-primary">
                      Create ticket from chat
                    </SubmitButton>
                  </form>
                  {ticketsR.data && ticketsR.data.length > 0 && (
                    <form action={linkChatToTicket} className="chat-control-form">
                      <input type="hidden" name="conversationId" value={conversation.id} />
                      <label htmlFor="chat-ticket">Link to an existing ticket</label>
                      <select
                        id="chat-ticket"
                        className="input"
                        name="ticketId"
                        required
                        defaultValue=""
                      >
                        <option value="">Choose a ticket</option>
                        {ticketsR.data.map((ticket) => (
                          <option key={ticket.id} value={ticket.id}>
                            #{ticket.ticket_number} · {ticket.title}
                          </option>
                        ))}
                      </select>
                      <SubmitButton className="button button-secondary">Link ticket</SubmitButton>
                    </form>
                  )}
                </>
              ) : (
                <p className="muted">The full chat history is attached to its linked ticket.</p>
              )}
              {conversation.status === 'open' && (
                <form action={closeChat} className="chat-control-form">
                  <input type="hidden" name="conversationId" value={conversation.id} />
                  <SubmitButton className="button button-secondary">
                    Close conversation
                  </SubmitButton>
                </form>
              )}
            </div>
          </details>
        )}
        <div className="chat-active-body">
          {notice.error && (
            <div className="alert alert-error" role="alert">
              {notice.error}
            </div>
          )}
          {notice.success && (
            <div className="alert alert-success" role="status">
              {notice.success}
            </div>
          )}
          {messagesR.error && (
            <div className="alert alert-error" role="alert">
              Messages could not be loaded.{' '}
              <Link href={`/app/chat/${conversation.id}`}>Try again</Link>
            </div>
          )}
          {attachmentsR.error && (
            <div className="alert alert-error" role="alert">
              Files could not be loaded.{' '}
              <Link href={`/app/chat/${conversation.id}`}>Try again</Link>
            </div>
          )}
          {!worker && conversation.ticket_id && (
            <Link
              className="button button-secondary"
              href={`/app/tickets/${conversation.ticket_id}`}
            >
              View linked ticket
            </Link>
          )}
          <ChatRoom
            key={conversation.id}
            conversationId={conversation.id}
            organizationId={viewer.organizationId}
            viewerId={viewer.id}
            isWorker={worker}
            open={conversation.status === 'open'}
            names={names}
            initialMessages={recentMessages(messagesR.data ?? [])}
            attachments={attachments}
            supportName={supportName}
            assigned={Boolean(supportId)}
            participantId={worker ? conversation.requester_id : supportId}
            readThrough={messagesR.error || attachmentsR.error ? undefined : readThrough}
            savedReplies={
              worker && !savedRepliesR.error ? (savedRepliesR.data ?? undefined) : undefined
            }
            replyContext={{
              requesterName: names[conversation.requester_id] ?? null,
              agentName: viewer.displayName,
            }}
          />
        </div>
      </section>
    </ChatCenter>
  );
}
