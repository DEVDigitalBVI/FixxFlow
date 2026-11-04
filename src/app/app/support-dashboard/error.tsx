'use client';

import { Button } from '@/components/ui/button';

export default function Error({ reset }: { reset: () => void }) {
  return (
    <div className="page stack">
      <h1>Support insights could not load</h1>
      <p role="alert">Please try again. If access has changed, reload the page.</p>
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
