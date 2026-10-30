import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit choice controls (FixxFlow theme). Unlike shadcn's Radix checkbox these stay native
 * inputs, so form submission, indeterminate state, labels and platform keyboard behavior are
 * unchanged; the kit supplies one consistent size, accent and focus treatment.
 */
const choiceClassName =
  'size-[18px] shrink-0 cursor-pointer accent-(color:--color-accent) focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-(color:--color-focus) disabled:cursor-not-allowed disabled:opacity-65';

type ChoiceProps = Omit<ComponentProps<'input'>, 'type'>;

function Checkbox({ className, ...props }: ChoiceProps) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(choiceClassName, className)}
      {...props}
    />
  );
}

function Radio({ className, ...props }: ChoiceProps) {
  return (
    <input type="radio" data-slot="radio" className={cn(choiceClassName, className)} {...props} />
  );
}

export { Checkbox, choiceClassName, Radio };
