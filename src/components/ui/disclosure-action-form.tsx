'use client';

import { useRef, type ReactNode } from 'react';

import { closeSavedDisclosure } from './close-saved-disclosure';

/** Preserve native server-action navigation and errors for legacy mutation forms. */
export function DisclosureActionForm({
  action,
  children,
  className,
}: {
  action: (data: FormData) => Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className={className}
      action={async (data) => {
        await action(data);
        if (form.current) closeSavedDisclosure(form.current);
      }}
    >
      {children}
    </form>
  );
}
