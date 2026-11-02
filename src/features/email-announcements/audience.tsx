'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox, Radio } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

import { emailAnnouncementsPath, type AnnouncementChoices, type AnnouncementMember } from './model';

export function AnnouncementAudience({
  choices,
  defaultSelection = null,
}: {
  choices: AnnouncementChoices;
  defaultSelection?: AnnouncementMember[] | null;
}) {
  const id = useId();
  const [audience, setAudience] = useState(defaultSelection === null ? 'all' : 'selected');
  const [selected, setSelected] = useState(
    () => new Map((defaultSelection ?? []).map((member) => [member.user_id, member])),
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [composing, setComposing] = useState(false);
  const [data, setData] = useState(choices);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const initial = useRef(true);
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        if (composing) return;
        setPending(true);
        setFailed(false);
        try {
          const response = await fetch(
            `${emailAnnouncementsPath}/recipients?${new URLSearchParams({ q: query, page: String(page) })}`,
            {
              cache: 'no-store',
              credentials: 'same-origin',
              redirect: 'error',
              signal: controller.signal,
            },
          );
          if (!response.ok) throw Error('Members unavailable');
          const result: AnnouncementChoices = await response.json();
          if (
            !Array.isArray(result.rows) ||
            typeof result.total !== 'number' ||
            result.rows.some(
              (row) =>
                typeof row.user_id !== 'string' ||
                typeof row.email !== 'string' ||
                typeof row.display_name !== 'string',
            )
          )
            throw Error('Invalid members');
          if (!cancelled) {
            setData(result);
            setPending(false);
          }
        } catch {
          if (!cancelled) {
            setFailed(true);
            setPending(false);
          }
        }
      },
      query ? 300 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, page, retry, composing]);
  function toggle(member: AnnouncementMember, checked: boolean) {
    setSelected((previous) => {
      const next = new Map(previous);
      if (checked && next.size < 500) next.set(member.user_id, member);
      if (!checked) next.delete(member.user_id);
      return next;
    });
  }
  return (
    <fieldset className="stack border-0 p-0 m-0 min-w-0" aria-describedby={`${id}-hint`}>
      <legend>Recipients</legend>
      <p id={`${id}-hint`} className="muted">
        Choose everyone in your company or select individual members.
      </p>
      <label className="check-field">
        <Radio
          name="audience"
          value="all"
          checked={audience === 'all'}
          onChange={() => setAudience('all')}
        />
        All registered members
      </label>
      <label className="check-field">
        <Radio
          name="audience"
          value="selected"
          checked={audience === 'selected'}
          onChange={() => setAudience('selected')}
        />
        Specific members
      </label>
      <div
        className="stack"
        hidden={audience !== 'selected'}
        style={audience !== 'selected' ? { display: 'none' } : undefined}
      >
        <div className="field">
          <label htmlFor={`${id}-search`}>Search members by name or email</label>
          <Input
            id={`${id}-search`}
            type="search"
            value={query}
            maxLength={200}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            onChange={(event) => {
              event.stopPropagation();
              setQuery(event.target.value);
              setPage(1);
              setPending(true);
            }}
          />
        </div>
        <p role="status">
          {selected.size} selected
          {pending
            ? ' · Loading members…'
            : failed
              ? ' · Members could not load. Your selections are kept.'
              : ` · ${data.total} matching members`}
        </p>
        {failed && (
          <Button type="button" variant="secondary" onClick={() => setRetry((value) => value + 1)}>
            Try again
          </Button>
        )}
        <ul className="stack list-none p-0">
          {data.rows.map((member) => (
            <li key={member.user_id}>
              <label className="check-field [overflow-wrap:anywhere]">
                <Checkbox
                  checked={selected.has(member.user_id)}
                  disabled={
                    pending || failed || (!selected.has(member.user_id) && selected.size >= 500)
                  }
                  onChange={(event) => toggle(member, event.target.checked)}
                />
                <span>
                  <strong>{member.display_name}</strong>
                  <br />
                  {member.email}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {!pending && !failed && !data.rows.length && <p>No members match this search.</p>}
        {(page > 1 || page * 50 < data.total) && (
          <div className="section-heading-row">
            <Button
              type="button"
              variant="quiet"
              disabled={pending || page === 1}
              onClick={() => {
                setPending(true);
                setPage((value) => value - 1);
              }}
            >
              Previous members
            </Button>
            <span>Page {page}</span>
            <Button
              type="button"
              variant="quiet"
              disabled={pending || failed || page * 50 >= data.total}
              onClick={() => {
                setPending(true);
                setPage((value) => value + 1);
              }}
            >
              More members
            </Button>
          </div>
        )}
        <details>
          <summary>Selected members ({selected.size})</summary>
          <ul className="stack list-none p-0">
            {[...selected.values()].map((member) => (
              <li key={member.user_id} className="section-heading-row">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {member.display_name} · {member.email}
                </span>
                <Button
                  type="button"
                  variant="quiet"
                  aria-label={`Remove ${member.display_name} (${member.email})`}
                  onClick={() => toggle(member, false)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </details>
        {selected.size > 0 && (
          <Button type="button" variant="secondary" onClick={() => setSelected(new Map())}>
            Clear selection
          </Button>
        )}
        <p className="muted">
          Select up to 500 individual members. To include everyone, choose All registered members.
        </p>
      </div>
      {audience === 'selected' &&
        [...selected.keys()].map((member) => (
          <input key={member} type="hidden" name="memberIds" value={member} />
        ))}
    </fieldset>
  );
}
