'use client';

import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit dialog (shadcn/ui on Radix Dialog, FixxFlow theme). Radix supplies the modal layer:
 * focus containment, Escape, outside dismissal, scroll locking and hidden background content.
 * Content renders in a portal so it is never trapped inside hidden or inert navigation.
 */
const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-[rgb(0_0_0/45%)]"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-32px)] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-(--radius-panel) border border-solid border-(color:--color-border-strong) bg-(color:--color-surface) p-6 text-(color:--color-text) [box-shadow:var(--shadow-overlay)] focus-visible:outline-hidden',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('m-0 font-(family-name:--font-heading)', className)}
      {...props}
    />
  );
}

export { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger };
