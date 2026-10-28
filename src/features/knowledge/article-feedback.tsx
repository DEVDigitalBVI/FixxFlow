'use client';

import { useEffect, useState } from 'react';

import { rateArticle, recordArticleView } from '@/app/app/help/actions';
import { NavigationIcon } from '@/components/navigation/navigation-icon';

export function ArticleFeedback({
  articleId,
  initial,
  library = false,
}: {
  articleId: string;
  initial: boolean | null;
  library?: boolean;
}) {
  const [selected, setSelected] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    void recordArticleView(articleId, library).catch(() => {});
  }, [articleId, library]);
  async function vote(helpful: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const result = await rateArticle(articleId, helpful, library);
      if (result.error) setMessage(result.error);
      else {
        setSelected(helpful);
        setMessage('Thanks—your feedback is saved.');
      }
    } catch {
      setMessage('Your feedback could not be saved. Please retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-card">
      <h2>Was this article helpful?</h2>
      <div className="knowledge-actions">
        <button
          className="button button-secondary"
          aria-pressed={selected === true}
          disabled={busy}
          onClick={() => vote(true)}
        >
          Helpful
          {selected === true && <NavigationIcon name="check" className="inline-icon" size={16} />}
        </button>
        <button
          className="button button-secondary"
          aria-pressed={selected === false}
          disabled={busy}
          onClick={() => vote(false)}
        >
          Not helpful
          {selected === false && <NavigationIcon name="check" className="inline-icon" size={16} />}
        </button>
      </div>
      <p role="status">{busy ? 'Saving feedback…' : message}</p>
    </section>
  );
}
