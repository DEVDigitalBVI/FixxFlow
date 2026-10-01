import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { activityLabels, formatTicketDate } from '@/features/tickets/presentation';
import { activityAuthorName, messageAuthorName, type MessageAuthor } from '@/features/tickets/authorship';
import { HISTORY_PAGE_SIZE, historyFilter, historyPage } from './history';

export type HistoryFilters = { before?: string; view?: string };

/** A bounded, stable archive separate from the live composer and its drafts. */
export async function HistoryBrowser({ kind, id, filters }: {
  kind: 'ticket' | 'chat'; id: string; filters: HistoryFilters;
}) {
  const viewer = await requireViewer();
  const db = await createClient();
  const org = viewer.organizationId;
  const parent = await db.from(kind === 'ticket' ? 'tickets' : 'chat_conversations')
    .select('id, requester_id').eq('organization_id', org).eq('id', id).maybeSingle();
  if (parent.error) throw new Error('History is unavailable. Please try again.');
  if (!parent.data || (viewer.role === 'end_user' && parent.data.requester_id !== viewer.id)) notFound();
  const staff = viewer.role !== 'end_user';
  const view = filters.view === 'files' ? 'files' : filters.view === 'activity' && staff && kind === 'ticket' ? 'activity' : 'messages';
  let filter: string | null;
  try { filter = historyFilter(filters.before); } catch { notFound(); }
  const base = `/app/${kind === 'ticket' ? 'tickets' : 'chat'}/${id}`;
  const href = (selected: string, before?: string) => `${base}/history?${new URLSearchParams({ view: selected, ...(before ? { before } : {}) })}`;
  let older: string | null;
  let content;

  if (view === 'files') {
    const source = kind === 'ticket'
      ? db.from('ticket_attachments').select('id, file_name, storage_path, size_bytes, created_at').eq('ticket_id', id)
      : db.from('chat_attachments').select('id, file_name, storage_path, size_bytes, created_at').eq('conversation_id', id);
    let query = source.eq('organization_id', org)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_PAGE_SIZE + 1);
    if (filter) query = query.or(filter);
    const { data, error } = await query;
    if (error) throw new Error('Files could not be loaded. Please try again.');
    const page = historyPage(data ?? []);
    older = page.older;
    const signed = page.items.length ? await db.storage.from(kind === 'ticket' ? 'ticket-attachments' : 'chat-attachments')
      .createSignedUrls(page.items.map(file => file.storage_path), 3600) : { data: [] };
    const urls = new Map((signed.data ?? []).map(file => [file.path, file.signedUrl ?? undefined]));
    content = page.items.length ? <ul className="attachment-list">{page.items.map(file => <li key={file.id}>
      {urls.get(file.storage_path) ? <a href={urls.get(file.storage_path)} target="_blank" rel="noreferrer">{file.file_name}</a> : <span>{file.file_name} · Link unavailable; refresh to retry</span>}
      <p>{Math.ceil(file.size_bytes / 1024)} KB · <time dateTime={file.created_at}>{formatTicketDate(file.created_at)}</time></p>
    </li>)}</ul> : <p>No files in this part of the history.</p>;
  } else if (view === 'activity') {
    let query = db.from('ticket_activity').select('id, actor_id, action, details, created_at').eq('organization_id', org).eq('ticket_id', id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_PAGE_SIZE + 1);
    if (filter) query = query.or(filter);
    const { data, error } = await query;
    if (error) throw new Error('Activity could not be loaded. Please try again.');
    const page = historyPage(data ?? []);
    older = page.older;
    const names = await authorNames(page.items.flatMap(row => row.actor_id ? [row.actor_id] : []));
    content = page.items.length ? <ol className="management-list">{page.items.map(row => <li key={row.id}>
      <strong>{activityAuthorName(row.actor_id, row.details, names)}</strong> {activityLabels[row.action] ?? row.action.replaceAll('_', ' ')}
      <p><time dateTime={row.created_at}>{formatTicketDate(row.created_at)}</time></p>
    </li>)}</ol> : <p>No activity in this part of the history.</p>;
  } else {
    const source = kind === 'ticket'
      ? db.from('ticket_messages').select('id, author_id, author_type, automation_name, kind, body, created_at').eq('ticket_id', id)
      : db.from('chat_messages').select('id, author_id, kind, body, created_at').eq('conversation_id', id);
    let query = source.eq('organization_id', org)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(HISTORY_PAGE_SIZE + 1);
    if (!staff) query = query.neq('kind', 'internal_note');
    if (filter) query = query.or(filter);
    const { data, error } = await query;
    if (error) throw new Error('Messages could not be loaded. Please try again.');
    const page = historyPage<MessageAuthor & { id: string; kind: string; body: string; created_at: string }>(data ?? []);
    older = page.older;
    const names = await authorNames(page.items.flatMap(row => row.author_id ? [row.author_id] : []));
    content = page.items.length ? <ol className="ticket-conversation">{page.items.toReversed().map(row => <li className={`conversation-item${row.kind === 'internal_note' ? ' conversation-item-note' : ''}`} key={row.id}>
      <article className="conversation-bubble"><header><strong>{messageAuthorName(row, names, viewer.id)}</strong><time dateTime={row.created_at}>{formatTicketDate(row.created_at)}</time></header>
        {staff && <p>{row.kind === 'internal_note' ? 'Internal note · IT staff only' : 'Public reply'}</p>}<p>{row.body}</p>
      </article>
    </li>)}</ol> : <p>No messages in this part of the history.</p>;
  }

  async function authorNames(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    const { data, error } = await db.from('profiles').select('user_id, display_name').eq('organization_id', org).in('user_id', unique);
    if (error) throw new Error('History authors could not be loaded. Please try again.');
    return new Map((data ?? []).map(profile => [profile.user_id, profile.display_name]));
  }

  return <div className={staff ? 'page stack' : 'portal-page stack'}>
    <header className="page-header"><div><Link href={base}>Back to conversation</Link><h1>Conversation history</h1><p>Up to {HISTORY_PAGE_SIZE} entries per page. Live replies remain in the conversation.</p></div></header>
    <nav className="queue-views" aria-label="History sections">{['messages', 'files', ...(staff && kind === 'ticket' ? ['activity'] : [])].map(section => <Link key={section} href={href(section)} aria-current={section === view ? 'page' : undefined}>{section === 'messages' ? 'Messages' : section === 'files' ? 'Files' : 'Activity'}</Link>)}</nav>
    <section className="settings-card" aria-label={`${view} history`}>{content}</section>
    <nav className="notification-pagination" aria-label="History pages">{filters.before && <Link className="button button-secondary" href={href(view)}>Latest entries</Link>}{older && <Link className="button button-secondary" href={href(view, older)}>Earlier {view}</Link>}</nav>
  </div>;
}
