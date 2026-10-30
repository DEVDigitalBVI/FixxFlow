import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit button (shadcn/ui, FixxFlow theme). `button` and `button-<variant>` remain stable hooks
 * for contextual layout rules, the shared busy indicator and forced-colors handling in globals.css.
 * Hover styles skip disabled, aria-disabled and busy states so inactive controls stay still.
 */
const buttonStyles = cva(
  [
    // 40px for pointers (the standard control height); touch screens keep 44px targets.
    'button inline-flex min-h-10 min-w-10 pointer-coarse:min-h-11 pointer-coarse:min-w-11 max-w-full shrink-0 cursor-pointer items-center justify-center gap-2',
    'rounded-(--radius-control) border border-solid border-transparent px-4 py-2',
    'text-center font-(family-name:--font-heading) text-sm/5 font-medium whitespace-normal [overflow-wrap:anywhere] no-underline',
    'transition-[color,background-color,border-color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
    'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-(color:--color-focus) focus-visible:outline-solid',
    'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
    'aria-busy:cursor-progress aria-busy:opacity-100',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      // Soft shadcn treatment: flat fills and faint edges; the label names every action.
      variant: {
        primary:
          'button-primary bg-(color:--color-action-fill) text-(color:--color-on-action) shadow-[0_1px_2px_rgb(26_26_26/6%)] hover:not-disabled:not-aria-disabled:not-aria-busy:bg-(color:--color-action-hover)',
        secondary:
          'button-secondary border-(color:--color-border) bg-(color:--color-surface) text-(color:--color-text) shadow-[0_1px_2px_rgb(26_26_26/6%)] hover:not-disabled:not-aria-disabled:not-aria-busy:bg-(color:--color-surface-subtle)',
        quiet:
          'button-quiet bg-transparent px-3 font-(family-name:--font-body) text-(color:--color-text-muted) hover:not-disabled:not-aria-disabled:not-aria-busy:bg-(color:--color-surface-subtle) hover:not-disabled:not-aria-disabled:not-aria-busy:text-(color:--color-text)',
        danger:
          'button-danger border-(color:--color-border) bg-(color:--color-surface) text-(color:--color-danger) shadow-[0_1px_2px_rgb(26_26_26/6%)] hover:not-disabled:not-aria-disabled:not-aria-busy:bg-(color:--color-danger-surface)',
      },
      size: {
        default: '',
        small: 'button-small px-3',
        icon: 'button-icon size-10 pointer-coarse:size-11 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'default' },
  },
);

/** Button classes for elements that only look like buttons, such as navigation links. */
function buttonVariants({
  className,
  ...variants
}: VariantProps<typeof buttonStyles> & { className?: string } = {}) {
  return cn(buttonStyles(variants), className);
}

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonStyles> & {
    /** Renders the single child (for example a Next.js Link) with button styling. */
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}

export { Button, buttonVariants, type ButtonProps };
