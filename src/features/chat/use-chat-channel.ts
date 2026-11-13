import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import { HISTORY_PAGE_SIZE } from '@/features/conversations/history';
import type { createClient } from '@/lib/supabase/client';

import { mergeChatMessages, parseChatMessage, type RoomMessage } from './message-model';

type ChannelOptions = {
  supabase: ReturnType<typeof createClient>;
  conversationId: string;
  organizationId: string;
  viewerId: string;
  isWorker: boolean;
  participantId?: string;
  connected: boolean;
  refresh: () => void;
  setLiveMessages: Dispatch<SetStateAction<RoomMessage[]>>;
  setConnected: Dispatch<SetStateAction<boolean>>;
  setOnline: Dispatch<SetStateAction<boolean>>;
  setTyping: Dispatch<SetStateAction<boolean>>;
};
/** Subscription effect and typing timers; the room retains reconciliation state. */
export function useChatChannel({
  supabase,
  conversationId,
  organizationId,
  viewerId,
  isWorker,
  participantId,
  connected,
  refresh,
  setLiveMessages,
  setConnected,
  setOnline,
  setTyping,
}: ChannelOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimer = useRef<number | null>(null);
  const remoteTimer = useRef<number | null>(null);
  const lastTyping = useRef(0);
  useEffect(() => {
    let disposed = false;
    const channel = supabase
      .channel(`chat:${conversationId}`, {
        config: { private: true, presence: { key: `${viewerId}:${crypto.randomUUID()}` } },
      })
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        ({ new: row }) => {
          const message = parseChatMessage(row, organizationId, conversationId, isWorker);
          if (disposed || !message) return;
          setLiveMessages((current) =>
            mergeChatMessages(current, [message]).slice(-HISTORY_PAGE_SIZE),
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_conversations',
          filter: `id=eq.${conversationId}`,
        },
        refresh,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_attachments',
          filter: `conversation_id=eq.${conversationId}`,
        },
        refresh,
      )
      .on('presence', { event: 'sync' }, () => {
        const others = Object.values(channel.presenceState())
          .flat()
          .some((value) => {
            const id = (value as { userId?: string }).userId;
            return Boolean(id && id !== viewerId && (!participantId || id === participantId));
          });
        setOnline(others);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.userId === viewerId || (participantId && payload?.userId !== participantId))
          return;
        setTyping(Boolean(payload?.typing));
        if (remoteTimer.current) window.clearTimeout(remoteTimer.current);
        if (payload?.typing) remoteTimer.current = window.setTimeout(() => setTyping(false), 3500);
      });
    channelRef.current = channel;
    void supabase.realtime
      .setAuth()
      .then(() => {
        if (disposed) return;
        channel.subscribe((status) => {
          if (disposed) return;
          setConnected(status === 'SUBSCRIBED');
          if (status !== 'SUBSCRIBED') {
            setOnline(false);
            setTyping(false);
          }
          if (status === 'SUBSCRIBED') {
            void channel.track({ userId: viewerId });
            refresh();
          }
        });
      })
      .catch(() => {
        if (!disposed) setConnected(false);
      });
    return () => {
      disposed = true;
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      if (remoteTimer.current) window.clearTimeout(remoteTimer.current);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
    // These are the room's stable React state setters. Keep subscription ownership
    // tied to the conversation and refresh callback, as it was before extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, organizationId, viewerId, isWorker, participantId, supabase, refresh]);

  function stopTyping() {
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: viewerId, typing: false },
    });
  }

  function announceTyping(value: string, kind: RoomMessage['kind']) {
    if (kind === 'internal_note' || !value.trim() || !connected) {
      stopTyping();
      return;
    }
    const now = Date.now();
    if (now - lastTyping.current > 1000) {
      lastTyping.current = now;
      void channelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: viewerId, typing: true },
      });
    }
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      void channelRef.current?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: viewerId, typing: false },
      });
    }, 1800);
  }

  return { stopTyping, announceTyping };
}
