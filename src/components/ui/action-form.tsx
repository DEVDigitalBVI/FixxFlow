'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';

import type { ActionResult } from '@/lib/action-result';

import { Alert } from './alert';
import { Button } from './button';
import { FormPendingContext } from './form-pending';
import { revealField } from './reveal-field';
import { useUnsavedChanges } from './unsaved-changes';

/** Keep the mounted controls (including dependent selects) intact on failure. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  protectDraft = true,
  id,
  beforeRedirect,
  pendingMessage,
}: {
  /** Runs after a successful save and before navigation; may return a replacement URL. */
  beforeRedirect?: (redirectTo: string) => Promise<string | void>;
  pendingMessage?: string | null;
  action: (data: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  id?: string;
  resetOnSuccess?: boolean;
  protectDraft?: boolean;
}) {
  const [result, setResult] = useState<ActionResult>({});
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const releaseDraft = useUnsavedChanges(dirty && protectDraft);
  const snapshot = (form: HTMLFormElement) =>
    JSON.stringify(
      Array.from(new FormData(form)).filter(
        ([name]) => !['submissionKey', 'revision', 'lookupLoadError'].includes(name),
      ),
    );
  const errorField = (name: string) => {
    const field = formRef.current?.elements?.namedItem(name);
    return field && 'focus' in field ? (field as HTMLElement) : null;
  };
  useEffect(() => {
    if (!result.error) return;
    for (const name of Object.keys(result.fieldErrors ?? {})) {
      const field = errorField(name);
      if (field) revealField(field);
    }
    if (feedback.current) {
      revealField(feedback.current);
      feedback.current?.focus();
    }
  }, [result]);

  return (
    <form
      ref={formRef}
      id={id}
      method="post"
      className={className}
      aria-busy={pending}
      onInvalidCapture={(event) => revealField(event.target as HTMLElement)}
      onFocusCapture={(event) => {
        if (!dirty) baseline.current = snapshot(event.currentTarget);
      }}
      onChange={(event) => {
        setDirty(
          protectDraft &&
            (baseline.current === null || baseline.current !== snapshot(event.currentTarget)),
        );
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy.current) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        busy.current = true;
        setResult({});
        startTransition(async () => {
          try {
            const next = await action(data);
            setResult(next);
            if (next.success || next.redirectTo) {
              releaseDraft();
              setDirty(false);
              baseline.current = null;
            }
            if (next.redirectTo) {
              let target = next.redirectTo;
              try {
                target = (await beforeRedirect?.(target)) || target;
              } catch {
                // The save already succeeded; never strand the user on the form.
              }
              router.push(target);
              return;
            }
            if (next.success && resetOnSuccess) form.reset();
          } catch {
            setResult({
              error:
                'We could not confirm the save. Your entries are preserved. Check your connection and try again.',
            });
          } finally {
            busy.current = false;
          }
        });
      }}
    >
      {result.error && (
        <Alert ref={feedback} tone="error" className="field-wide" role="alert" tabIndex={-1}>
          {result.error}
          {result.fieldErrors && (
            <ul>
              {Object.entries(result.fieldErrors).map(([name, message]) => (
                <li key={name}>
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() => {
                      const field = errorField(name);
                      if (field) {
                        revealField(field);
                        field.focus();
                      }
                    }}
                  >
                    {message}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {result.success && (
        <Alert tone="success" className="field-wide" role="status">
          {result.success}
        </Alert>
      )}
      <FormPendingContext value={pending || Boolean(result.redirectTo)}>
        <fieldset className="action-form-fields" disabled={pending || Boolean(result.redirectTo)}>
          {children}
        </fieldset>
      </FormPendingContext>
      <span className="field-wide muted" role="status">
        {result.redirectTo || pending
          ? (pendingMessage ?? (result.redirectTo ? 'Opening…' : 'Saving…'))
          : ''}
      </span>
    </form>
  );
}
