"use client";

import { useEffect, useId, useRef, useState } from "react";
import { suggestArticles, type SuggestedArticle } from "./suggestions";

export function TicketSuggestions({ articles, categories, unavailable = false }: {
  articles: SuggestedArticle[];
  categories: { id: string; name: string }[];
  unavailable?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const heading = useId();
  const [selection, setSelection] = useState({ text: '', category: '' });
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    let timeout: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timeout);
      const values = new FormData(form);
      const next = { text: `${values.get('title') ?? ''} ${values.get('description') ?? ''}`, category: String(values.get('categoryId') ?? '') };
      timeout = setTimeout(() => {
        setSelection(next);
      }, 250);
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
    return () => { clearTimeout(timeout); form.removeEventListener('input', update); form.removeEventListener('change', update); };
  }, []);
  const matches = suggestArticles(articles, selection.text, categories.find(category => category.id === selection.category)?.name ?? '');
  return <section ref={ref} className="ticket-suggestions field-wide" aria-labelledby={heading}>
    <h2 id={heading}>Guides that may help</h2>
    <p className="muted">Optional help while you write. You can submit your request at any time.</p>
    <p className="sr-only" role="status">{matches.length ? `${matches.length} suggested guides available.` : ''}</p>
    {unavailable ? <p>Suggestions are unavailable. You can still submit your request.</p> : matches.length ? <ul>{matches.map(article => <li key={article.id}><a href={`/app/help/${article.id}`} target="_blank" rel="noopener noreferrer">{article.title}<span className="sr-only"> (opens in a new tab)</span></a><p>{article.summary}</p></li>)}</ul> : <p className="muted">{selection.text.trim() || selection.category ? 'No matching guides yet. Continue with your request.' : 'Describe the issue or choose a category to see relevant guides.'}</p>}
    <a href="/app/help" target="_blank" rel="noopener noreferrer">Browse all guides (opens in a new tab)</a>
  </section>;
}
