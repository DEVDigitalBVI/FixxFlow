import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit skeleton (shadcn/ui, FixxFlow theme). Static by design: the product avoids decorative
 * loading motion, so there is no pulse. Placeholders are decorative and hidden from assistive
 * technology; pair them with one written loading announcement.
 */
function Skeleton({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'block h-12 rounded-(--radius-control) bg-(color:--color-surface-subtle)',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
