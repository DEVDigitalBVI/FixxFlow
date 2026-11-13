'use client';

import Link from 'next/link';
import { useId, useRef, useState } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { renderSavedReply, type SavedReply, type SavedReplyContext } from './saved-replies';
import { useLazyTicketList } from './use-lazy-ticket-list';

const validReplies = (value: unknown): value is SavedReply[] =>
  Array.isArray(value) &&
  value.length <= 200 &&
  value.every(
    (reply) =>
      reply &&
      typeof reply === 'object' &&
      typeof reply.id === 'string' &&
      typeof reply.title === 'string' &&
      typeof reply.body === 'string',
  );

/**
 * Staff-only picker shared by the ticket and chat composers. Choosing a reply
 * inserts filled-in text into the current draft for review; nothing is sent.
 */
export function SavedReplyPicker({
  replies: initialReplies,
  lazy = false,
  context,
  onInsert,
  disabled = false,
}: {
  replies?: SavedReply[];
  lazy?: boolean;
  context: SavedReplyContext;
  onInsert: (text: string) => void;
  disabled?: boolean;
}) {
  const list = useLazyTicketList(
    '/app/tickets/choices?kind=saved-replies',
    initialReplies ?? (lazy ? undefined : []),
    validReplies,
  );
  const replies = list.items;
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const details = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = replies.filter((reply) => {
    const text = `${reply.title} ${reply.body}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  return (
    <details
      className="saved-reply-picker"
      ref={details}
      onToggle={(event) => {
        if (event.currentTarget.open) void list.load();
      }}
    >
      <summary className={buttonVariants({ variant: 'secondary' })}>Saved replies</summary>
      <div className="saved-reply-panel">
        {list.phase === 'loading' ? (
          <p role="status">Loading saved replies…</p>
        ) : list.phase === 'error' ? (
          <div role="status">
            <p>Saved replies could not load. You can still write and send your message.</p>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                if (await list.load()) requestAnimationFrame(() => search.current?.focus());
              }}
            >
              Retry saved replies
            </Button>
          </div>
        ) : replies.length ? (
          <>
            <label htmlFor={`${id}-search`}>Find a saved reply</label>
            <Input
              ref={search}
              id={`${id}-search`}
              type="search"
              value={query}
              maxLength={120}
              onChange={(event) => setQuery(event.target.value)}
              aria-describedby={`${id}-hint ${id}-count`}
              autoComplete="off"
            />
            <p id={`${id}-hint`} className="muted">
              Choosing a reply adds it to your draft so you can edit it before sending.
            </p>
            <p id={`${id}-count`} className="sr-only" role="status">
              {matches.length} saved {matches.length === 1 ? 'reply' : 'replies'}
            </p>
            {matches.length ? (
              <ul className="saved-reply-list">
                {matches.map((reply) => (
                  <li key={reply.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        onInsert(renderSavedReply(reply.body, context));
                        setQuery('');
                        if (details.current) details.current.open = false;
                      }}
                    >
                      <strong>{reply.title}</strong>
                      <span>{reply.body.split('\n')[0]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No saved replies match. Try fewer or different words.</p>
            )}
          </>
        ) : (
          <p className="muted">
            No saved replies yet. Save answers you send often, then add them here in one click.
          </p>
        )}
        <Link className="saved-reply-manage" href="/app/administration/saved-replies">
          Manage saved replies
        </Link>
      </div>
    </details>
  );
}
