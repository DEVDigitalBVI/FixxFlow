import type { ComponentProps } from 'react';

import { chevronDownPath } from '@/components/navigation/navigation-icon';
import { cn } from '@/lib/utils';

/*
 * Shared field surface for the UI kit's text controls (shadcn/ui, FixxFlow theme). The `input`
 * hook class keeps contextual widths and compact toolbar rules in globals.css working.
 */
const fieldClassName = [
  'input w-full max-w-full min-w-0 min-h-10 pointer-coarse:min-h-11 rounded-(--radius-control) border border-solid border-(color:--color-control-border)',
  'bg-(color:--color-surface) px-3 py-2 font-(family-name:--font-body) font-normal text-(color:--color-text)',
  'shadow-(--shadow-field) transition-[border-color,box-shadow,background-color] duration-150 ease-out motion-reduce:transition-none',
  'placeholder:text-(color:--color-text-subtle) placeholder:opacity-100',
  'file:mr-3 file:cursor-pointer file:border-0 file:bg-transparent file:font-(family-name:--font-heading) file:font-semibold file:text-(color:--color-text)',
  'focus:border-(color:--color-focus) focus:outline-hidden focus:ring-3 focus:ring-(color:--color-focus)/40',
  'disabled:cursor-not-allowed disabled:bg-(color:--color-surface-subtle) disabled:text-(color:--color-text-muted)',
  '[&[readonly]]:bg-(color:--color-surface-subtle) [&[readonly]]:text-(color:--color-text-muted)',
  'aria-invalid:border-2 aria-invalid:border-(color:--color-danger) aria-invalid:focus:border-(color:--color-danger) aria-invalid:focus:ring-(color:--color-danger)/40',
].join(' ');

type FieldSize = 'default' | 'compact';
const sizeClassName: Record<FieldSize, string> = {
  default: '',
  compact: 'input-compact min-h-9 pointer-coarse:min-h-11 px-2.5 py-1.5',
};

function Input({
  className,
  fieldSize = 'default',
  ...props
}: ComponentProps<'input'> & { fieldSize?: FieldSize }) {
  return (
    <input
      data-slot="input"
      className={cn(fieldClassName, sizeClassName[fieldSize], className)}
      {...props}
    />
  );
}

function Textarea({
  className,
  fieldSize = 'default',
  ...props
}: ComponentProps<'textarea'> & { fieldSize?: 'default' | 'tall' }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        fieldClassName,
        'resize-y',
        fieldSize === 'tall' && 'textarea min-h-[110px]',
        className,
      )}
      {...props}
    />
  );
}

// Shared icon-family geometry; a CSS image preserves the native select DOM and picker behavior.
// The slate stroke matches the light field edge and exceeds 3:1 on both light and dark surfaces.
const selectChevron = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#818c9e" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${chevronDownPath}"/></svg>`)}")`;

/** Native select keeps platform pickers and keyboard behavior; only the closed control is themed. */
function NativeSelect({
  className,
  fieldSize = 'default',
  multiple,
  size,
  style,
  ...props
}: ComponentProps<'select'> & { fieldSize?: FieldSize }) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        fieldClassName,
        sizeClassName[fieldSize],
        'cursor-pointer',
        !multiple && !(size && size > 1) && 'native-select-control',
        className,
      )}
      {...props}
      multiple={multiple}
      size={size}
      style={{
        backgroundImage: !multiple && !(size && size > 1) ? selectChevron : undefined,
        ...style,
      }}
    />
  );
}

export { fieldClassName, Input, NativeSelect, Textarea };
