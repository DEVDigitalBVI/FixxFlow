'use client';

import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { TAG_HINT, TICKET_TAG_LENGTH } from './tags';
import { useLazyTicketList } from './use-lazy-ticket-list';

const validTags = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 50 &&
  value.every((tag) => typeof tag === 'string' && tag.length <= 40);
export function TagSuggestions({
  ticketId,
  tags,
  suggestions,
}: {
  ticketId: string;
  tags: string[];
  suggestions?: string[];
}) {
  const field = useRef<HTMLInputElement>(null);
  const list = useLazyTicketList('/app/tickets/choices?kind=tags', suggestions, validTags);
  const load = useRef(list.load);
  useEffect(() => {
    load.current = list.load;
  });
  useEffect(() => {
    const disclosure = field.current?.closest('details');
    if (!disclosure) return;
    const toggle = () => {
      if (disclosure.open) void load.current();
    };
    toggle();
    disclosure.addEventListener('toggle', toggle);
    return () => disclosure.removeEventListener('toggle', toggle);
  }, []);
  return (
    <div className="field">
      <label htmlFor={`ticket-tag-${ticketId}`}>Add a tag</label>
      <Input
        ref={field}
        id={`ticket-tag-${ticketId}`}
        name="tag"
        required
        maxLength={TICKET_TAG_LENGTH}
        list={`ticket-tag-options-${ticketId}`}
        autoComplete="off"
        onFocus={() => {
          void list.load();
        }}
        aria-describedby={`ticket-tag-hint-${ticketId} ticket-tag-load-${ticketId}`}
      />
      <datalist id={`ticket-tag-options-${ticketId}`}>
        {list.items
          .filter((tag) => !tags.includes(tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
      <small id={`ticket-tag-hint-${ticketId}`} className="muted">
        {TAG_HINT}
      </small>
      <div id={`ticket-tag-load-${ticketId}`} className="ticket-tag-load" role="status">
        {list.phase === 'loading' && 'Loading tag suggestions…'}
        {list.phase === 'error' && (
          <>
            Tag suggestions could not load. You can still enter a tag.{' '}
            <Button
              type="button"
              variant="quiet"
              onClick={async () => {
                if (await list.load()) field.current?.focus();
              }}
            >
              Retry suggestions
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
