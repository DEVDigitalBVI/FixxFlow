import Link from 'next/link';
import type { ReactNode } from 'react';

import { NavigationIcon } from '@/components/navigation/navigation-icon';

/** Shared workspace heading. Navigation stays a native link; actions retain their own semantics. */
export function PageHeader({
  title,
  description,
  eyebrow,
  back,
  actions,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <>
      {back && (
        <Link className="button button-quiet page-back-link" href={back.href}>
          <NavigationIcon name="arrowLeft" className="inline-icon" size={16} />
          {back.label}
        </Link>
      )}
      <header className={['page-header', className].filter(Boolean).join(' ')}>
        <div>
          {eyebrow && <span className="page-eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </header>
    </>
  );
}
