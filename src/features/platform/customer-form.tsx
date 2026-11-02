'use client';

import { useState, type ChangeEvent } from 'react';

import { saveCustomer } from '@/app/platform/actions';
import { ActionForm } from '@/components/ui/action-form';
import { Input } from '@/components/ui/input';
import { SubmitButton } from '@/components/ui/submit-button';
import { TimezoneSelect } from '@/features/timezones/select';

export function CustomerForm({ customer }: { customer?: { id: string; name: string } }) {
  const [draft, setDraft] = useState({
    name: customer?.name ?? '',
    slug: '',
    admin: '',
    email: '',
  });
  const change = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const field = event.target;
    setDraft((d) => ({ ...d, [field.name]: field.value }));
  };
  return (
    <ActionForm action={saveCustomer.bind(null, customer?.id ?? null, {})} className="stack">
      <label className="field">
        Organization name *
        <Input
          name="name"
          required
          minLength={2}
          maxLength={120}
          onChange={change}
          value={draft.name}
        />
      </label>
      {!customer && (
        <>
          <label className="field">
            Workspace address *
            <Input
              name="slug"
              onChange={change}
              value={draft.slug}
              required
              minLength={2}
              maxLength={63}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              aria-describedby="slug-help"
            />
          </label>
          <p id="slug-help" className="muted">
            A unique identifier using lowercase letters, numbers and hyphens.
          </p>
          <label className="field">
            Administrator name *
            <Input name="admin" onChange={change} value={draft.admin} required maxLength={120} />
          </label>
          <label className="field">
            Administrator email *
            <Input
              type="email"
              name="email"
              onChange={change}
              value={draft.email}
              required
              maxLength={254}
            />
          </label>
          <TimezoneSelect value="UTC" />
          <p className="muted">
            The administrator must first create and verify an account, without joining or creating
            an organization. This assigns that account as this customer’s administrator. No email is
            sent from this form.
          </p>
        </>
      )}
      <SubmitButton variant="primary">
        {customer ? 'Save name' : 'Create organization'}
      </SubmitButton>
    </ActionForm>
  );
}
