'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

type Factor = { id: string; friendly_name?: string };

export function MfaEnrollment({
  required = false,
  onVerified,
}: { required?: boolean; onVerified?: () => void | Promise<void> } = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const locked = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(
    null,
  );
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const supabase = createClient();

  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  async function run(operation: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError(false);
    try {
      await operation();
    } catch {
      setError(true);
      setMessage('Account protection could not be updated. Please try again.');
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  async function refresh() {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) {
        setLoadState('error');
        return;
      }
      setFactors(data?.totp.filter((factor) => factor.status === 'verified') ?? []);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }
  useEffect(() => {
    let active = true;
    void supabase.auth.mfa
      .listFactors()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setLoadState('error');
          return;
        }
        setFactors(data?.totp.filter((factor) => factor.status === 'verified') ?? []);
        setLoadState('ready');
      })
      .catch(() => {
        if (active) setLoadState('error');
      });
    return () => {
      active = false;
    };
  }, [supabase.auth.mfa]);

  async function begin() {
    setMessage('');
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `FixxFlow ${factors.length + 1}`,
    });
    if (error) {
      setError(true);
      setMessage('Authenticator setup could not be started.');
      return;
    }
    setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify() {
    if (!enrollment || !/^\d{6}$/.test(code.trim())) return;
    const challenge = await supabase.auth.mfa.challenge({ factorId: enrollment.id });
    if (challenge.error) {
      setError(true);
      setMessage('Verification could not be started.');
      return;
    }
    const result = await supabase.auth.mfa.verify({
      factorId: enrollment.id,
      challengeId: challenge.data.id,
      code: code.trim(),
    });
    if (result.error) {
      setError(true);
      setMessage('That verification code was not accepted.');
      return;
    }
    setEnrollment(null);
    setCode('');
    setMessage('Authenticator enabled.');
    await refresh();
    await onVerified?.();
  }

  async function remove(id: string) {
    if (required && factors.length <= 1) {
      setError(true);
      setMessage(
        'Your workspace requires an authenticator. Add a backup before removing this one.',
      );
      return;
    }
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    setError(Boolean(error));
    setMessage(error ? 'The authenticator could not be removed.' : 'Authenticator removed.');
    if (!error) await refresh();
  }

  if (loadState === 'loading') return <p role="status">Checking account protection…</p>;
  if (loadState === 'error')
    return (
      <div role="alert">
        <p>Account protection could not load.</p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setLoadState('loading');
            void refresh();
          }}
        >
          Try again
        </button>
      </div>
    );
  return (
    <div className="stack">
      <div className="security-status">
        <div>
          <strong>Authenticator app</strong>
          <p className="muted">
            {factors.length
              ? `Two-step verification enabled · ${factors.length} authenticator${factors.length === 1 ? '' : 's'}`
              : 'Two-step verification is not set up'}
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={pending}
          onClick={() => run(begin)}
        >
          Add authenticator
        </button>
      </div>
      {enrollment && (
        <form
          className="enrollment-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void run(verify);
          }}
        >
          <Image
            unoptimized
            src={enrollment.qr}
            alt="Authenticator QR code"
            width={180}
            height={180}
          />
          <div className="stack">
            <p>Scan this QR code, then enter the six-digit code from your authenticator.</p>
            <code>{enrollment.secret}</code>
            <label htmlFor="enrollment-code">Verification code</label>
            <input
              id="enrollment-code"
              className="input"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              aria-label="Verification code"
              aria-invalid={error || undefined}
              aria-describedby={error ? 'enrollment-feedback' : undefined}
              disabled={pending}
            />
            <button
              className="button button-primary"
              type="submit"
              disabled={pending || !/^\d{6}$/.test(code.trim())}
            >
              {pending ? 'Verifying…' : 'Verify and enable'}
            </button>
          </div>
        </form>
      )}
      {required && (
        <p className="muted">
          Your workspace requires an authenticator. Keep at least one verified authenticator, and
          add a backup when possible.
        </p>
      )}
      {factors.map((factor) => (
        <div className="security-status" key={factor.id}>
          <span>{factor.friendly_name ?? 'Authenticator'}</span>
          <button
            className="button button-danger button-small"
            type="button"
            disabled={pending || (required && factors.length <= 1)}
            onClick={() => run(() => remove(factor.id))}
          >
            Remove
          </button>
        </div>
      ))}
      {message && (
        <p
          id="enrollment-feedback"
          ref={feedback}
          tabIndex={-1}
          role={error ? 'alert' : 'status'}
          className="form-note"
        >
          {message}
        </p>
      )}
    </div>
  );
}
