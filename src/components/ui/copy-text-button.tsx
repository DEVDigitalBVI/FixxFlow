'use client';

import { useState } from 'react';

import { Button } from './button';

export function CopyTextButton({ text, label = 'Copy address' }: { text: string; label?: string }) {
  const [message, setMessage] = useState('');
  return (
    <span className="copy-text-control">
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setMessage('Copied.');
          } catch {
            setMessage('Could not copy. Select and copy the address above.');
          }
        }}
      >
        {label}
      </Button>
      <span role="status" className="muted">
        {message}
      </span>
    </span>
  );
}
