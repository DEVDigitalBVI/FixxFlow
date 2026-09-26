"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormPendingContext } from "./form-pending";

export type ActionResult = { error?: string; success?: string; redirectTo?: string };

/** Keep the mounted controls (including dependent selects) intact on failure. */
export function ActionForm({ action, children, className, resetOnSuccess = false }: {
  action: (data: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [result, setResult] = useState<ActionResult>({});
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { if (result.error) feedback.current?.focus(); }, [result]);

  return <form method="post" className={className} aria-busy={pending} onSubmit={event => {
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
        if (next.redirectTo) { router.push(next.redirectTo); return; }
        if (next.success && resetOnSuccess) form.reset();
      } catch {
        setResult({ error: "We could not confirm the save. Your entries are preserved. Check your connection and try again." });
      } finally { busy.current = false; }
    });
  }}>
    {result.error && <div ref={feedback} className="alert alert-error field-wide" role="alert" tabIndex={-1}>{result.error}</div>}
    {result.success && <div className="alert alert-success field-wide" role="status">{result.success}</div>}
    <FormPendingContext value={pending || Boolean(result.redirectTo)}><fieldset className="action-form-fields" disabled={pending || Boolean(result.redirectTo)}>{children}</fieldset></FormPendingContext>
    <span className="field-wide muted" role="status">{result.redirectTo ? "Opening your request…" : pending ? "Saving…" : ""}</span>
  </form>;
}
