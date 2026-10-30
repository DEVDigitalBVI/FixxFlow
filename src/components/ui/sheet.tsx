'use client';

import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit sheet (shadcn/ui on Radix Dialog, FixxFlow theme): focus containment, Escape, scroll
 * locking, hidden background content and focus return to the trigger come from Radix.
 */
const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

function SheetOverlay({ className, ...props }: ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn('fixed inset-0 z-50 bg-[rgb(26_26_26/38%)]', className)}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = 'right',
  portal = true,
  overlayClassName,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'left' | 'right';
  /** Render in place when the panel relies on its surrounding layout styles. */
  portal?: boolean;
  overlayClassName?: string;
}) {
  const content = (
    <>
      <SheetOverlay className={overlayClassName} />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed inset-y-0 z-50 flex w-[min(86vw,320px)] flex-col gap-4 overflow-y-auto overscroll-contain bg-(color:--color-surface) p-4 [box-shadow:var(--shadow-overlay)]',
          side === 'right' ? 'right-0' : 'left-0',
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </>
  );
  return portal ? <SheetPrimitive.Portal>{content}</SheetPrimitive.Portal> : content;
}

function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('m-0 font-(family-name:--font-heading) font-semibold', className)}
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger };
