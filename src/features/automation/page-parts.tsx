import Link from 'next/link';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';

import { automationPath } from './ui-model';

export function AutomationHeader({
  title,
  description,
  back = automationPath,
  backLabel,
  actions,
}: {
  title: string;
  description: string;
  back?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={title}
      description={description}
      eyebrow="Settings"
      back={{
        href: back,
        label: backLabel ?? (back === '/app/administration' ? 'Settings' : 'Automations'),
      }}
      actions={actions}
    />
  );
}
export function AutomationPages({
  page,
  hasNext,
  href,
}: {
  page: number;
  hasNext: boolean;
  href: (page: number) => string;
}) {
  if (page <= 1 && !hasNext) return null;
  return (
    <nav className="queue-views" aria-label="Automation pages">
      {page > 1 && (
        <Link className={buttonVariants({ variant: 'secondary' })} href={href(page - 1)}>
          Previous
        </Link>
      )}
      <span>Page {page}</span>
      {hasNext && (
        <Link className={buttonVariants({ variant: 'secondary' })} href={href(page + 1)}>
          Next
        </Link>
      )}
    </nav>
  );
}
