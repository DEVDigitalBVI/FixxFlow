'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { setLibraryVisibility } from '@/app/app/help/actions';

export function LibraryVisibilityButton({
  articleId,
  title,
  initialHidden,
}: {
  articleId: string;
  title: string;
  initialHidden: boolean;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(initialHidden);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function toggle() {
    setPending(true);
    setError('');
    try {
      const result = await setLibraryVisibility(articleId, !hidden);
      if (result.error) setError(result.error);
      else {
        setHidden(!hidden);
        router.refresh();
      }
    } catch {
      setError('Visibility could not be saved. Please retry.');
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="knowledge-library-visibility" aria-busy={pending}>
      <span role="status">
        {hidden ? 'Hidden in this workspace' : 'Available in this workspace'}
      </span>
      <button
        type="button"
        className="button button-secondary"
        aria-label={`${hidden ? 'Show' : 'Hide'} ${title} ${hidden ? 'in' : 'from'} this workspace`}
        disabled={pending}
        onClick={() => void toggle()}
      >
        {pending ? 'Saving…' : hidden ? 'Show in workspace' : 'Hide from workspace'}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
