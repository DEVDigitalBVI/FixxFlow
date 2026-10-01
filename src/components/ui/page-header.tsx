import Link from 'next/link';
import type { ReactNode } from 'react';

/** Shared workspace heading. Navigation stays a native link; actions retain their own semantics. */
export function PageHeader({ title, description, eyebrow, back, actions }: {
  title: string;
  description?: string;
  eyebrow?: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return <>
    {back && <Link className="button button-quiet page-back-link" href={back.href}><span aria-hidden="true">←</span>{back.label}</Link>}
    <header className="page-header">
      <div>{eyebrow && <span className="page-eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  </>;
}
