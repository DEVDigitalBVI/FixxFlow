import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit alert (shadcn/ui, FixxFlow theme). Callers keep choosing the element and live-region
 * role (`alert` for failures, `status` for confirmations) because announcements differ by context.
 * `alert` and `alert-<tone>` remain hooks for contextual spacing rules.
 */
const alertStyles = cva(
  'alert rounded-(--radius-control) border border-solid px-3.5 py-3 [overflow-wrap:anywhere]',
  {
    variants: {
      tone: {
        neutral:
          'border-(color:--color-border) bg-(color:--color-surface-subtle) text-(color:--color-text)',
        info: 'alert-info border-(color:--color-border) bg-(color:--color-surface-subtle) text-(color:--color-text)',
        success:
          'alert-success border-(color:--color-success)/22 bg-(color:--color-success-subtle) text-(color:--color-success)',
        warning:
          'alert-warning border-(color:--color-warning)/25 bg-(color:--color-warning-subtle) text-(color:--color-warning)',
        error:
          'alert-error border-(color:--color-danger)/25 bg-(color:--color-danger-surface) text-(color:--color-danger)',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

type AlertElement = 'div' | 'p' | 'aside' | 'section';
type AlertProps<E extends AlertElement> = { as?: E } & ComponentProps<E> &
  VariantProps<typeof alertStyles>;

function Alert<E extends AlertElement = 'div'>({ as, tone, className, ...props }: AlertProps<E>) {
  // The allowed elements share the same flow attributes; type the render as a div.
  const Element = (as ?? 'div') as 'div';
  return (
    <Element
      data-slot="alert"
      className={cn(alertStyles({ tone }), className)}
      {...(props as ComponentProps<'div'>)}
    />
  );
}

export { Alert };
