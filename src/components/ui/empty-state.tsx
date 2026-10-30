import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit empty state (shadcn/ui "Empty" pattern, FixxFlow theme). Content stays caller-owned so
 * each screen can explain why it is empty and offer the next action; `empty-state` remains a hook.
 */
const emptyStateClassName = [
  'empty-state px-6 py-14 text-center text-(color:--color-text-muted)',
  '[&_strong]:block [&_strong]:text-base [&_strong]:text-(color:--color-text)',
  '[&_p]:mx-auto [&_p]:mb-0 [&_p]:max-w-[55ch] [&_p]:leading-[1.6]',
  '[&>.button]:mt-4',
].join(' ');

type EmptyElement = 'div' | 'p' | 'section';

function EmptyState<E extends EmptyElement = 'div'>({
  as,
  className,
  ...props
}: { as?: E } & ComponentProps<E>) {
  // The allowed elements share the same flow attributes; type the render as a div.
  const Element = (as ?? 'div') as 'div';
  return (
    <Element
      data-slot="empty-state"
      className={cn(emptyStateClassName, className)}
      {...(props as ComponentProps<'div'>)}
    />
  );
}

export { EmptyState, emptyStateClassName };
