import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit badge (shadcn/ui, FixxFlow theme). Tones are semantic; the written label always carries
 * the meaning and color only reinforces it. `badge` stays a hook for contextual layout rules.
 */
const badgeStyles = cva(
  'badge inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-solid border-transparent px-[9px] py-1 font-(family-name:--font-heading) text-xs/4 font-semibold',
  {
    variants: {
      tone: {
        neutral: 'bg-(color:--color-neutral-subtle) text-(color:--color-neutral)',
        active: 'bg-(color:--color-active-surface) text-(color:--color-active)',
        info: 'bg-(color:--color-active-surface) text-(color:--color-active)',
        warning: 'bg-(color:--color-warning-subtle) text-(color:--color-warning)',
        success: 'bg-(color:--color-success-subtle) text-(color:--color-success)',
        danger: 'bg-(color:--color-danger-surface) text-(color:--color-danger)',
        muted:
          'border-(color:--color-border) bg-(color:--color-surface-subtle) text-(color:--color-text-muted)',
        highlight: 'bg-(color:--color-highlight-surface) text-(color:--color-highlight)',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

type BadgeTone = NonNullable<VariantProps<typeof badgeStyles>['tone']>;
type BadgeElement = 'span' | 'p';

function Badge<E extends BadgeElement = 'span'>({
  as,
  tone,
  className,
  ...props
}: { as?: E } & ComponentProps<E> & VariantProps<typeof badgeStyles>) {
  // Both elements accept the same phrasing attributes; type the render as a span.
  const Element = (as ?? 'span') as 'span';
  return (
    <Element
      data-slot="badge"
      className={cn(badgeStyles({ tone }), className)}
      {...(props as ComponentProps<'span'>)}
    />
  );
}

export { Badge, badgeStyles, type BadgeTone };
