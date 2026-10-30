import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/*
 * UI kit table (shadcn/ui, FixxFlow theme). Rows and cells stay native `tr`/`th`/`td` so
 * responsive card layouts and `data-label` cells keep working; the kit owns the base treatment.
 * `table-region` and `table` remain hooks for contextual width and compact-screen rules.
 */
function TableRegion({ className, ...props }: ComponentProps<'div'> & { 'aria-label': string }) {
  return (
    <div
      data-slot="table-region"
      role="region"
      tabIndex={0}
      className={cn(
        'table-region overflow-x-auto rounded-(--radius-card) border border-solid border-(color:--color-border) bg-(color:--color-surface) [box-shadow:var(--shadow-card)]',
        className,
      )}
      {...props}
    />
  );
}

const tableClassName = [
  'table w-full min-w-[900px] border-collapse',
  '[&_caption]:p-4 [&_caption]:text-left [&_caption]:font-(family-name:--font-heading) [&_caption]:font-semibold',
  '[&_th]:border-b [&_th]:border-(color:--color-border) [&_th]:bg-(color:--color-surface-subtle) [&_th]:px-4 [&_th]:py-[11px] [&_th]:text-left [&_th]:font-(family-name:--font-heading) [&_th]:text-xs [&_th]:font-semibold [&_th]:text-(color:--color-text-muted) [&_th]:[overflow-wrap:anywhere]',
  '[&_td]:h-16 [&_td]:border-b [&_td]:border-(color:--color-border) [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-middle [&_td]:[overflow-wrap:anywhere]',
  '[&_tr:last-child_td]:border-b-0',
  '[&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 motion-reduce:[&_tbody_tr]:transition-none [&_tbody_tr:hover]:bg-(color:--color-surface-subtle) [&_tbody_tr:focus-within]:bg-(color:--color-accent-subtle)',
].join(' ');

function Table({ className, ...props }: ComponentProps<'table'>) {
  return <table data-slot="table" className={cn(tableClassName, className)} {...props} />;
}

export { Table, tableClassName, TableRegion };
