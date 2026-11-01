import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

export function HelpNavigation({ current }: { current: 'knowledge' | 'fixxflow' }) {
  return (
    <nav className="queue-views" aria-label="Help collections">
      <Link
        className={buttonVariants({ variant: 'secondary' })}
        href="/app/help"
        aria-current={current === 'knowledge' ? 'page' : undefined}
      >
        Knowledge base
      </Link>
      <Link
        className={buttonVariants({ variant: 'secondary' })}
        href="/app/faq"
        aria-current={current === 'fixxflow' ? 'page' : undefined}
      >
        FixxFlow Help &amp; FAQ
      </Link>
    </nav>
  );
}
