import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit choice controls (FixxFlow theme). Unlike shadcn's Radix checkbox these stay native
 * inputs, so form submission, indeterminate state, labels and platform keyboard behavior are
 * unchanged; the kit supplies one consistent soft shadcn-style box, check and focus treatment.
 * The drawing lives in globals.css, keyed on data-slot, beside its forced-colors fallback.
 */

type ChoiceProps = Omit<ComponentProps<'input'>, 'type'>;

function Checkbox({ className, ...props }: ChoiceProps) {
  return (
    <input type="checkbox" data-slot="checkbox" className={cn('shrink-0', className)} {...props} />
  );
}

function Radio({ className, ...props }: ChoiceProps) {
  return <input type="radio" data-slot="radio" className={cn('shrink-0', className)} {...props} />;
}

export { Checkbox, Radio };
