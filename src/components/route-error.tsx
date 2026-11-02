'use client';

import Link from 'next/link';

import { Button, buttonVariants } from '@/components/ui/button';

type Props = {
  retry: () => void;
  title: string;
  message: string;
  layout?: 'page' | 'card' | 'narrow' | 'main';
  back?: { href: string; label: string };
};

/** Shared recovery controls; route boundaries retain their own context and copy. */
export function RouteError({ retry, title, message, layout = 'page', back }: Props) {
  const contents = (
    <>
      <h1>{title}</h1>
      <p role="alert">{message}</p>
      <div className="route-error-actions">
        <Button type="button" variant="primary" onClick={retry}>
          Try again
        </Button>
        {back && (
          <Link className={buttonVariants({ variant: 'secondary' })} href={back.href}>
            {back.label}
          </Link>
        )}
      </div>
    </>
  );
  const panel = (
    <section
      className={layout === 'page' ? 'route-error-panel' : 'settings-card route-error-panel'}
    >
      {contents}
    </section>
  );
  if (layout === 'card') return panel;
  if (layout === 'main')
    return (
      <main id="main-content" className="page page-narrow route-error-page">
        {panel}
      </main>
    );
  if (layout === 'narrow') return <div className="page page-narrow route-error-page">{panel}</div>;
  return <div className="page route-error-page">{panel}</div>;
}
