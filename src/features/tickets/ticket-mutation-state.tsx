'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Flags = { dirty: boolean; work: boolean; reply: boolean };
type MutationState = {
  workBlocked: boolean;
  replyStatusBlocked: boolean;
  setWorkDirty: (dirty: boolean) => void;
  beginWork: () => boolean;
  endWork: () => void;
  beginReplyStatus: () => boolean;
  endReplyStatus: () => void;
};
const Context = createContext<MutationState | null>(null);

/** One scope per full ticket/drawer. Synchronous locks also cover same-event races. */
export function TicketMutationProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Flags>({ dirty: false, work: false, reply: false });
  const locks = useRef<Flags>({ dirty: false, work: false, reply: false });
  const setWorkDirty = useCallback((dirty: boolean) => {
    locks.current.dirty = dirty;
    setFlags((current) => (current.dirty === dirty ? current : { ...current, dirty }));
  }, []);
  const beginWork = useCallback(() => {
    if (locks.current.reply || locks.current.work) return false;
    locks.current.work = true;
    setFlags((current) => ({ ...current, work: true }));
    return true;
  }, []);
  const endWork = useCallback(() => {
    locks.current.work = false;
    setFlags((current) => ({ ...current, work: false }));
  }, []);
  const beginReplyStatus = useCallback(() => {
    if (locks.current.dirty || locks.current.work || locks.current.reply) return false;
    locks.current.reply = true;
    setFlags((current) => ({ ...current, reply: true }));
    return true;
  }, []);
  const endReplyStatus = useCallback(() => {
    locks.current.reply = false;
    setFlags((current) => ({ ...current, reply: false }));
  }, []);
  return (
    <Context.Provider
      value={{
        workBlocked: flags.work || flags.reply,
        replyStatusBlocked: flags.dirty || flags.work || flags.reply,
        setWorkDirty,
        beginWork,
        endWork,
        beginReplyStatus,
        endReplyStatus,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useTicketMutationState() {
  return useContext(Context);
}
