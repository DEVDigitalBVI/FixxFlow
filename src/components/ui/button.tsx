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
    'button inline-flex min-h-11 min-w-11 max-w-full shrink-0 cursor-pointer items-center justify-center gap-2',
    'rounded-(--radius-control) border border-solid border-transparent px-4 py-2.5',
    'text-center font-(family-name:--font-heading) text-sm/5 font-semibold whitespace-normal [overflow-wrap:anywhere] no-underline',
    'transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out',
    'active:not-disabled:not-aria-disabled:not-aria-busy:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0',
    'focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-(color:--color-focus) focus-visible:outline-solid',
    'disabled:cursor-not-allowed disabled:opacity-65 aria-disabled:cursor-not-allowed aria-disabled:opacity-65',
    'aria-busy:cursor-progress aria-busy:opacity-100',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'button-primary border-(color:--color-brand-ink) bg-(color:--color-action-fill) text-(color:--color-on-action) shadow-[0_1px_2px_rgb(26_26_26/8%)] hover:not-disabled:not-aria-disabled:not-aria-busy:bg-(color:--color-action-hover)',
        secondary:
          'button-secondary border-(color:--color-control-border) bg-(color:--color-surface) text-(color:--color-text) shadow-[0_1px_2px_rgb(26_26_26/5%)] hover:not-disabled:not-aria-disabled:not-aria-busy:bg-(color:--color-field-hover)',
        quiet:
          'button-quiet bg-transparent px-3 font-(family-name:--font-body) font-medium text-(color:--color-text-muted) hover:not-disabled:not-aria-disabled:not-aria-busy:border-(color:--color-border-strong) hover:not-disabled:not-aria-disabled:not-aria-busy:bg-(color:--color-surface-subtle) hover:not-disabled:not-aria-disabled:not-aria-busy:text-(color:--color-text)',
        danger:
          'button-danger border-(color:--color-danger) bg-(color:--color-danger-surface) text-(color:--color-danger) hover:not-disabled:not-aria-disabled:not-aria-busy:bg-(color:--color-field-hover)',
      },
      size: {
        default: '',
        small: 'button-small px-3 text-[13px]',
        icon: 'button-icon size-11 p-0',
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
