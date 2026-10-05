"use client";

import { recordCompletedLogin } from "@/features/product-analytics/actions";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string };

export function MfaChallenge({ destination = "/app" }: { destination?: "/app" | "/platform" } = {}) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [factorId, setFactorId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [isPending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function loadFactors() {
      try {
        const result = await supabase.auth.mfa.listFactors();
        if (!active) return;
        if (result.error) throw result.error;
        const verified = result.data?.totp.filter(item => item.status === "verified") ?? [];
        setFactors(verified);
        setFactorId(current => verified.some(item => item.id === current) ? current : verified[0]?.id ?? "");
        setLoadError(verified.length ? "" : "No verified authenticator is available. Contact your administrator.");
      } catch {
        if (active) setLoadError("Authenticators could not load. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadFactors();
    return () => { active = false; };
  }, [supabase, attempt]);

  useEffect(() => { if (error || loadError) errorRef.current?.focus(); }, [error, loadError]);

  function verify(formData: FormData) {
    if (loading || loadError || isPending) return;
    const selectedId = String(formData.get("factorId") ?? "");
    const enteredCode = String(formData.get("code") ?? "").trim();
    setError("");
    return startTransition(async () => {
      try {
        // Recheck the selected factor in case another session removed it.
        const result = await supabase.auth.mfa.listFactors();
        if (result.error) { setError("Authenticators could not be verified. Please try again."); return; }
        const factor = result.data?.totp.find(item => item.status === "verified" && item.id === selectedId);
        if (!factor) { setError("This authenticator is no longer available. Reload authenticators and choose another."); return; }
        const challenge = await supabase.auth.mfa.challenge({ factorId: factor.id });
        if (challenge.error) { setError("We could not start verification. Try again."); return; }
        const verified = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.data.id, code: enteredCode });
        if (verified.error) { setError("That code was not accepted. Check the selected authenticator and try again."); return; }
        await recordCompletedLogin().catch(() => {});
        router.replace(destination);
        router.refresh();
      } catch { setError("Verification could not finish. Please try again."); }
    });
  }

  function reload() {
    setLoading(true); setLoadError(""); setError(""); setAttempt(value => value + 1);
  }

  return <form action={verify} className="stack">
    {(error || loadError) && <div ref={errorRef} tabIndex={-1} id="mfa-error" className="alert alert-error" role="alert">{error || loadError}</div>}
    {loading && <p role="status">Loading authenticators…</p>}
    <div className="field">
      <label htmlFor="factorId">Authenticator</label>
      <select className="input" id="factorId" name="factorId" value={factorId} required disabled={loading || !!loadError || isPending} aria-describedby="mfa-factor-hint" onChange={event => { setFactorId(event.target.value); setCode(""); setError(""); }}>
        {!factors.length && <option value="">No authenticators available</option>}
        {factors.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.friendly_name || `Authenticator ${index + 1}`}</option>)}
      </select>
      <p id="mfa-factor-hint" className="muted">Choose the authenticator you have access to, then enter its code.</p>
    </div>
    <div className="field">
      <label htmlFor="code">Verification code</label>
      <input className="input" id="code" name="code" value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={loading || !!loadError || isPending} aria-describedby={error ? "mfa-error" : undefined} />
    </div>
    <button className="button button-primary" type="submit" disabled={loading || !!loadError || !factorId || isPending} aria-busy={isPending}>{isPending ? "Verifying…" : "Verify and continue"}</button>
    <button className="button button-secondary" type="button" disabled={loading || isPending} onClick={reload}>Reload authenticators</button>
  </form>;
}
