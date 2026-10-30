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
      {back ? (
        <div className={layout === 'main' ? 'page-header-actions' : 'knowledge-actions'}>
          <Button type="button" variant="primary" onClick={retry}>
            Try again
          </Button>
          <Link className={buttonVariants({ variant: 'secondary' })} href={back.href}>
            {back.label}
          </Link>
        </div>
      ) : (
        <Button type="button" variant="primary" onClick={retry}>
          Try again
        </Button>
      )}
    </>
  );
  if (layout === 'card') return <section className="settings-card">{contents}</section>;
  if (layout === 'main')
    return (
      <main id="main-content" className="page page-narrow">
        <section className="settings-card">{contents}</section>
      </main>
    );
  if (layout === 'narrow')
    return (
      <div className="page page-narrow">
        <section className="settings-card">{contents}</section>
      </div>
    );
  return <div className="page">{contents}</div>;
}
