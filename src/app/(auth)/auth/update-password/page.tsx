import { Alert } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';

import { updatePassword } from '../../actions';

type Props = { searchParams: Promise<{ error?: string }> };
export default async function UpdatePasswordPage({ searchParams }: Props) {
  const message = await searchParams;
  return (
    <section className="auth-card" aria-labelledby="password-heading">
      <h1 id="password-heading">Choose a new password</h1>
      <p className="auth-intro">Use at least 8 characters and avoid passwords used elsewhere.</p>
      <form action={updatePassword} className="stack">
        {message.error && (
          <Alert tone="error" role="alert">
            {message.error}
          </Alert>
        )}
        <div className="field">
          <label htmlFor="password">New password</label>
          <Input
            id="password"
            name="password"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="passwordConfirmation">Confirm new password</label>
          <Input
            id="passwordConfirmation"
            name="passwordConfirmation"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </div>
        <SubmitButton variant="primary" pendingLabel="Updating password…">
          Update password
        </SubmitButton>
      </form>
    </section>
  );
}
