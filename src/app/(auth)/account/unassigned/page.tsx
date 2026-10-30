import { redirect } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignupProgress } from '@/components/ui/signup-progress';
import { TimezoneSelect } from '@/features/timezones/select';
import { createClient } from '@/lib/supabase/server';

import { signOut } from '../../actions';
import { bootstrapOrganization } from '../actions';

type Props = { searchParams: Promise<{ error?: string }> };

export default async function UnassignedPage({ searchParams }: Props) {
  const message = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) {
    const { data: access } = await supabase.rpc('platform_access');
    if (access && access !== 'none') redirect('/platform');
  }
  const suggestedName =
    typeof data?.claims?.user_metadata === 'object' &&
    data.claims.user_metadata &&
    'display_name' in data.claims.user_metadata
      ? String(data.claims.user_metadata.display_name ?? '')
      : '';
  return (
    <section className="auth-card auth-card-wide">
      <SignupProgress current={3} />
      <span className="page-eyebrow">Organization setup</span>
      <h1>Create your workspace</h1>
      <p className="auth-intro">
        Tell us about your organization. You’ll become its first administrator and can invite your
        team next.
      </p>
      <form action={bootstrapOrganization} className="stack">
        {message.error && (
          <Alert tone="error" role="alert">
            {message.error}
          </Alert>
        )}
        <div className="field">
          <label htmlFor="organizationName">Organization name</label>
          <Input
            id="organizationName"
            name="organizationName"
            autoComplete="organization"
            required
            minLength={2}
            maxLength={120}
            placeholder="Acme Company"
          />
        </div>
        <div className="field">
          <label htmlFor="organizationSlug">Workspace identifier</label>
          <div className="input-prefix">
            <span aria-hidden="true">fixxflow.com/</span>
            <input
              id="organizationSlug"
              name="organizationSlug"
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              minLength={2}
              maxLength={63}
              aria-describedby="slug-hint"
              placeholder="acme-company"
              required
            />
          </div>
          <p className="form-note" id="slug-hint">
            Use lowercase letters, numbers, and hyphens. This uniquely identifies your workspace.
          </p>
        </div>
        <div className="field">
          <label htmlFor="administratorName">Administrator name</label>
          <Input
            id="administratorName"
            name="administratorName"
            autoComplete="name"
            defaultValue={suggestedName}
            required
            maxLength={120}
          />
        </div>
        <TimezoneSelect value="UTC" />
        <p className="form-note">
          Choose the timezone used for organization reports and shared days.
        </p>
        <div className="onboarding-summary">
          <strong>Your workspace includes</strong>
          <ul>
            <li>Your administrator account</li>
            <li>An IT Support team</li>
            <li>Starter ticket categories</li>
          </ul>
        </div>
        <Button variant="primary" type="submit">
          Create organization
        </Button>
      </form>
      <form action={signOut} className="auth-secondary-action">
        <button className="link-button" type="submit">
          Sign out and finish later
        </button>
      </form>
    </section>
  );
}
