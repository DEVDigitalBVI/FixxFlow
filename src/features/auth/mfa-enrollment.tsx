"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; friendly_name?: string };

export function MfaEnrollment() {
  const [loadState,setLoadState] = useState<'loading'|'ready'|'error'>('loading');
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const supabase = createClient();

  async function refresh() { try { const { data,error } = await supabase.auth.mfa.listFactors(); if(error){setLoadState('error');return;} setFactors(data?.totp.filter((factor) => factor.status === "verified") ?? []);setLoadState('ready'); } catch { setLoadState('error'); } }
  useEffect(() => {
    let active = true;
    void supabase.auth.mfa.listFactors().then(({ data,error }) => {
      if (!active) return;
      if(error){setLoadState('error');return;}
      setFactors(data?.totp.filter((factor) => factor.status === "verified") ?? []);setLoadState('ready');
    }).catch(()=>{if(active)setLoadState('error');});
    return () => { active = false; };
  }, [supabase.auth.mfa]);

  async function begin() {
    setMessage("");
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `FixxFlow ${factors.length + 1}` });
    if (error) { setMessage("Authenticator setup could not be started."); return; }
    setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify() {
    if (!enrollment) return;
    const challenge = await supabase.auth.mfa.challenge({ factorId: enrollment.id });
    if (challenge.error) { setMessage("Verification could not be started."); return; }
    const result = await supabase.auth.mfa.verify({ factorId: enrollment.id, challengeId: challenge.data.id, code: code.trim() });
    if (result.error) { setMessage("That verification code was not accepted."); return; }
    setEnrollment(null); setCode(""); setMessage("Authenticator enabled."); await refresh();
  }

  async function remove(id: string) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    setMessage(error ? "The authenticator could not be removed." : "Authenticator removed.");
    if (!error) await refresh();
  }

  if(loadState==='loading')return <p role="status">Checking account protection…</p>;
  if(loadState==='error')return <div role="alert"><p>Account protection could not load.</p><button type="button" className="button button-secondary" onClick={()=>{setLoadState('loading');void refresh();}}>Try again</button></div>;
  return <div className="stack"><div className="security-status"><div><strong>Authenticator app</strong><p className="muted">{factors.length ? `Two-step verification enabled · ${factors.length} authenticator${factors.length === 1 ? "" : "s"}` : "Two-step verification is not set up"}</p></div><button className="button button-secondary" type="button" onClick={begin}>Add authenticator</button></div>{enrollment && <div className="enrollment-panel"><Image unoptimized src={enrollment.qr} alt="Authenticator QR code" width={180} height={180} /><div className="stack"><p>Scan this QR code, then enter the six-digit code from your authenticator.</p><code>{enrollment.secret}</code><label htmlFor="enrollment-code">Verification code</label><input id="enrollment-code" className="input" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} aria-label="Verification code" /><button className="button button-primary" type="button" onClick={verify}>Verify and enable</button></div></div>}{factors.map((factor) => <div className="security-status" key={factor.id}><span>{factor.friendly_name ?? "Authenticator"}</span><button className="button button-danger button-small" type="button" onClick={() => remove(factor.id)}>Remove</button></div>)}{message && <p role="status" className="form-note">{message}</p>}</div>;
}
