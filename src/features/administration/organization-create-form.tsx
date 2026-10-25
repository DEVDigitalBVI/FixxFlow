'use client';

import { useState } from 'react';

import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';
import type { ActionResult } from '@/lib/action-result';

export function OrganizationCreateForm({
  kind,
  action,
  timezone = 'UTC',
}: {
  kind: 'department' | 'location';
  action: (data: FormData) => Promise<ActionResult>;
  timezone?: string;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fields =
    kind === 'department'
      ? [
          { name: 'name', label: 'Name', required: true, maxLength: 100 },
          { name: 'description', label: 'Description', maxLength: 2000 },
        ]
      : [
          { name: 'name', label: 'Name', required: true, maxLength: 100 },
          { name: 'city', label: 'City' },
          { name: 'region', label: 'Region' },
          { name: 'countryCode', label: 'Country code', maxLength: 2 },
          { name: 'timezone', label: 'Timezone', required: true },
        ];
  return (
    <ActionForm
      className="stack"
      resetOnSuccess
      action={async (data) => {
        const result = await action(data);
        setErrors(result.fieldErrors ?? {});
        return result;
      }}
    >
      <p className="form-note">Fields marked * are required.</p>
      {fields.map((field) => {
        const id = `${kind}-${field.name}`,
          errorId = `${id}-error`;
        return (
          <div className="field" key={field.name}>
            <label htmlFor={id}>
              {field.label}
              {field.required && <span aria-hidden="true"> *</span>}
            </label>
            <input
              className="input"
              id={id}
              name={field.name}
              required={field.required}
              maxLength={field.maxLength}
              defaultValue={
                field.name === 'timezone' ? timezone : field.name === 'countryCode' ? 'VG' : ''
              }
              aria-invalid={Boolean(errors[field.name]) || undefined}
              aria-describedby={errors[field.name] ? errorId : undefined}
            />
            {errors[field.name] && (
              <p id={errorId} className="field-error">
                {errors[field.name]}
              </p>
            )}
          </div>
        );
      })}
      <SubmitButton className="button button-primary" pendingLabel={`Adding ${kind}…`}>
        Add {kind}
      </SubmitButton>
    </ActionForm>
  );
}
