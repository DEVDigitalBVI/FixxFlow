import { useRef, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from 'react';

import { HISTORY_PAGE_SIZE } from '@/features/conversations/history';
import type { createClient } from '@/lib/supabase/client';

import type { RoomMessage } from './message-model';

type SendOptions = {
  supabase: ReturnType<typeof createClient>;
  draft: string;
  kind: RoomMessage['kind'];
  open: boolean;
  isWorker: boolean;
  organizationId: string;
  conversationId: string;
  viewerId: string;
  followLatestRef: RefObject<boolean>;
  setReadingHistory: Dispatch<SetStateAction<boolean>>;
  setOutgoing: Dispatch<SetStateAction<RoomMessage | null>>;
  stopTyping: () => void;
  setSending: Dispatch<SetStateAction<boolean>>;
  setFeedback: Dispatch<SetStateAction<string>>;
  setLiveMessages: Dispatch<SetStateAction<RoomMessage[]>>;
  setDrafts: Dispatch<SetStateAction<{ message: string; internal_note: string }>>;
  refresh: () => void;
};
export function useChatSend({
  supabase,
  draft,
  kind,
  open,
  isWorker,
  organizationId,
  conversationId,
  viewerId,
  followLatestRef,
  setReadingHistory,
  setOutgoing,
  stopTyping,
  setSending,
  setFeedback,
  setLiveMessages,
  setDrafts,
  refresh,
}: SendOptions) {
  const pendingMessage = useRef<{ id: string; body: string; kind: RoomMessage['kind'] } | null>(
    null,
  );
  const sendInFlight = useRef(false);
  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sendInFlight.current || !open) return;
    sendInFlight.current = true;
    const audience = isWorker ? kind : 'message';
    if (
      !pendingMessage.current ||
      pendingMessage.current.body !== body ||
      pendingMessage.current.kind !== audience
    ) {
      pendingMessage.current = { id: crypto.randomUUID(), body, kind: audience };
    }
    const pending = pendingMessage.current;
    followLatestRef.current = true;
    setReadingHistory(false);
    setOutgoing({ ...pending, author_id: viewerId, created_at: new Date().toISOString() });
    stopTyping();
    setSending(true);
    setFeedback('');
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          id: pending.id,
          organization_id: organizationId,
          conversation_id: conversationId,
          author_id: viewerId,
          kind: audience,
          body,
        })
        .select('id, author_id, kind, body, created_at')
        .single();
      let saved = data;
      if (error) {
        const { data: existing } = await supabase
          .from('chat_messages')
          .select('id, author_id, kind, body, created_at')
          .eq('id', pending.id)
          .eq('organization_id', organizationId)
          .eq('conversation_id', conversationId)
          .maybeSingle();
        if (
          !existing ||
          existing.author_id !== viewerId ||
          existing.kind !== audience ||
          existing.body !== body
        )
          throw error;
        saved = existing;
      }
      if (saved)
        setLiveMessages((current) =>
          [...current.filter((item) => item.id !== saved.id), saved].slice(-HISTORY_PAGE_SIZE),
        );
      setDrafts((current) => ({
        ...current,
        [audience]: current[audience] === draft ? '' : current[audience],
      }));
      pendingMessage.current = null;
      refresh();
    } catch {
      setFeedback('Message not sent. Your draft is still here; try again.');
    } finally {
      setOutgoing(null);
      sendInFlight.current = false;
      setSending(false);
    }
  }

  return sendMessage;
}
