'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import { knowledgeAudiences } from './audience';
import type { SuggestedArticle } from './suggestions';

export function TicketSuggestions({ showAudience = false }: { showAudience?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const heading = useId();
  const generation = useRef(0);
  const [selection, setSelection] = useState({ text: '', category: '' });
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; rows: SuggestedArticle[]; error: boolean }>({
    key: '',
    rows: [],
    error: false,
  });
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const values = new FormData(form);
      const text = String(values.get('title') ?? '')
        .trim()
        .slice(0, 180);
      const category = values.get('categoryId')
        ? (form
            .querySelector<HTMLSelectElement>('select[name=categoryId]')
            ?.selectedOptions[0]?.textContent?.replace(/ \(inactive\)$/, '') ?? '')
        : '';
      timer = setTimeout(() => setSelection({ text, category }), 250);
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
    return () => {
      clearTimeout(timer);
      form.removeEventListener('input', update);
      form.removeEventListener('change', update);
    };
  }, []);
  const active = selection.text.length >= 3 || Boolean(selection.category);
  const key = JSON.stringify([selection, retry]);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    if (!active) return () => controller.abort();
    const params = new URLSearchParams({ q: selection.text, category: selection.category });
    void fetch(`/app/help/suggestions?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!Array.isArray(result.rows)) throw new Error();
        if (current === generation.current && !controller.signal.aborted)
          setState({ key, rows: result.rows, error: false });
      })
      .catch(() => {
        if (current === generation.current && !controller.signal.aborted)
          setState({ key, rows: [], error: true });
      });
    return () => controller.abort();
  }, [key, active, selection.text, selection.category, retry]);
  const pending = state.key !== key;
  return (
    <section
      ref={ref}
      hidden={!active}
      className={`ticket-suggestions field-wide${active ? '' : ' ticket-suggestions-empty'}`}
      aria-labelledby={active ? heading : undefined}
    >
      {active && (
        <>
          <h2 id={heading}>Guides that may help</h2>
          {pending ? (
            <p className="muted" role="status">
              Looking for related guides…
            </p>
          ) : state.error ? (
            <p role="status">
              Guides couldn’t load. You can still submit your request.{' '}
              <Button type="button" variant="quiet" onClick={() => setRetry((value) => value + 1)}>
                Retry
              </Button>
            </p>
          ) : state.rows.length ? (
            <>
              <p className="sr-only" role="status">
                {state.rows.length} related guides found.
              </p>
              <ul>
                {state.rows.map((article) => (
                  <li key={article.id}>
                    <a href={`/app/help/${article.id}`} target="_blank" rel="noopener noreferrer">
                      {article.title}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                    <p>{article.summary}</p>
                    {article.organization_id === null && (
                      <span className="muted">FixxFlow library</span>
                    )}
                    {showAudience && article.audience && (
                      <span className="muted">{knowledgeAudiences[article.audience].label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted" role="status">
              No related guides found. Continue with your request.
            </p>
          )}
        </>
      )}
    </section>
  );
}
