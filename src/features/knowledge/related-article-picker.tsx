'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { knowledgeAudiences } from './audience';
import type { ArticleChoice } from './choices';

export function RelatedArticlePicker({
  articleId,
  library = false,
  initial,
}: {
  articleId: string;
  library?: boolean;
  initial: ArticleChoice[];
}) {
  const id = useId();
  const [selected, setSelected] = useState(initial);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    rows: ArticleChoice[];
    more: boolean;
    pending: boolean;
    error: boolean;
  }>({ rows: [], more: false, pending: true, error: false });
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        setState((old) => ({ ...old, pending: true, error: false }));
        const params = new URLSearchParams({
          scope: library ? 'library' : 'workspace',
          exclude: articleId,
          q: query,
          page: String(page),
        });
        void fetch(`/app/help/choices?${params}`, { signal: controller.signal, cache: 'no-store' })
          .then(async (response) => {
            if (!response.ok) throw new Error();
            const result = await response.json();
            if (!Array.isArray(result.rows)) throw new Error();
            if (current === generation.current && !controller.signal.aborted)
              setState({
                rows: result.rows,
                more: result.more === true,
                pending: false,
                error: false,
              });
          })
          .catch(() => {
            if (current === generation.current && !controller.signal.aborted)
              setState((old) => ({ ...old, pending: false, error: true }));
          });
      },
      query ? 250 : 0,
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [articleId, library, query, page, retry]);
  function toggle(article: ArticleChoice) {
    setSelected((old) =>
      old.some((item) => item.id === article.id)
        ? old.filter((item) => item.id !== article.id)
        : old.length < 8
          ? [...old, article]
          : old,
    );
  }
  return (
    <div className="knowledge-related-picker">
      <p id={`${id}-hint`} className="muted">
        Choose up to eight. Readers only see articles they have access to.
      </p>
      {selected.map((article) => (
        <input key={article.id} type="hidden" name="related" value={article.id} />
      ))}
      {!!selected.length && (
        <div className="knowledge-related-selected">
          <p>Selected ({selected.length}/8)</p>
          {selected.map((article) => (
            <label key={article.id}>
              <input type="checkbox" checked onChange={() => toggle(article)} />
              {article.title}
            </label>
          ))}
        </div>
      )}
      <label htmlFor={`${id}-search`}>Search article titles</label>
      <input
        id={`${id}-search`}
        className="input"
        type="search"
        value={query}
        maxLength={200}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
        aria-describedby={`${id}-hint`}
      />
      <div className="knowledge-related-options" aria-busy={state.pending}>
        {state.pending ? (
          <p role="status">Loading articles…</p>
        ) : state.error ? (
          <p role="alert">
            Articles couldn’t load.{' '}
            <button
              className="button button-quiet"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry
            </button>
          </p>
        ) : (
          <>
            {state.rows
              .filter((article) => !selected.some((item) => item.id === article.id))
              .map((article) => (
                <label key={article.id}>
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={selected.length >= 8}
                    onChange={() => toggle(article)}
                  />
                  {article.title}
                  {article.audience ? ` · ${knowledgeAudiences[article.audience].label}` : ''}
                </label>
              ))}
            {!state.rows.length && <p>No matching articles found.</p>}
          </>
        )}
      </div>
      <div className="knowledge-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={page === 1 || state.pending}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          className="button button-secondary"
          disabled={!state.more || state.pending || state.error}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
