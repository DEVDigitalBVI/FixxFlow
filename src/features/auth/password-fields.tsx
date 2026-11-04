'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Input } from '@/components/ui/input';

import {
  PASSWORD_MIN_LENGTH,
  passwordPolicyMessage,
  passwordRequirements,
} from './password-policy';

export function PasswordFields({
  label = 'New password',
  columns = false,
}: {
  label?: string;
  columns?: boolean;
}) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmationInput = useRef<HTMLInputElement>(null);
  const checks = passwordRequirements.map((rule) => ({ ...rule, met: rule.test(password) }));
  const count = checks.filter((rule) => rule.met).length;
  const matches = password.length > 0 && password === confirmation;
  useEffect(() => {
    passwordInput.current?.setCustomValidity(password ? passwordPolicyMessage(password) : '');
    confirmationInput.current?.setCustomValidity(
      confirmation && !matches ? 'The passwords do not match.' : '',
    );
  }, [password, confirmation, matches]);
  return (
    <div className="password-fields stack">
      <div className={columns ? 'signup-fields' : 'stack'}>
        <div className="field">
          <label htmlFor={`${id}-password`}>{label}</label>
          <Input
            ref={passwordInput}
            id={`${id}-password`}
            name="password"
            type="password"
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setPasswordTouched(true)}
            aria-invalid={(passwordTouched && count < checks.length) || undefined}
            aria-describedby={`${id}-requirements ${id}-screening`}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-confirmation`}>Confirm new password</label>
          <Input
            ref={confirmationInput}
            id={`${id}-confirmation`}
            name="passwordConfirmation"
            type="password"
            minLength={PASSWORD_MIN_LENGTH}
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            onBlur={() => setConfirmationTouched(true)}
            aria-invalid={(confirmationTouched && !matches) || undefined}
            aria-describedby={`${id}-matching`}
          />
        </div>
      </div>
      <section className="password-requirements" aria-labelledby={`${id}-requirements-heading`}>
        <h2 id={`${id}-requirements-heading`}>Password requirements</h2>
        <ul id={`${id}-requirements`}>
          {checks.map((rule) => (
            <li key={rule.id} data-met={rule.met}>
              <NavigationIcon name={rule.met ? 'check' : 'close'} size={16} />
              <span>
                <span className="sr-only">{rule.met ? 'Met: ' : 'Not met: '}</span>
                {rule.label}
              </span>
            </li>
          ))}
          <li id={`${id}-matching`} data-met={matches}>
            <NavigationIcon name={matches ? 'check' : 'close'} size={16} />
            <span>
              <span className="sr-only">{matches ? 'Met: ' : 'Not met: '}</span>Passwords match
            </span>
          </li>
        </ul>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {count} of {checks.length} password requirements met.{' '}
          {matches ? 'Passwords match.' : 'Passwords do not match yet.'}
        </p>
        <p className="form-note" id={`${id}-screening`}>
          Common or exposed passwords are also checked when you save. Use a long, unique password or
          passphrase.
        </p>
      </section>
    </div>
  );
}
