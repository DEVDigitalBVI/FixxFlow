'use client';

import Link from 'next/link';
import { useState } from 'react';

import { saveWorkspaceSecurity } from '@/app/app/administration/security/actions';
import { ActionForm } from '@/components/ui/action-form';
import { SubmitButton } from '@/components/ui/submit-button';

import styles from './authentication.module.css';

export function WorkspaceSecurityForm({
  required,
  revision: initialRevision,
  canChange,
}: {
  required: boolean;
  revision: number;
  canChange: boolean;
}) {
  const [revision, setRevision] = useState(initialRevision);
  return (
    <ActionForm
      className={`stack ${styles.policy}`}
      action={async (form) => {
        const result = await saveWorkspaceSecurity(form);
        if (result.revision !== undefined) setRevision(result.revision);
        return result;
      }}
    >
      <input type="hidden" name="revision" value={revision} />
      <label className={styles.choice}>
        <input type="checkbox" name="require_mfa" defaultChecked={required} disabled={!canChange} />{' '}
        Require two-step verification for everyone
      </label>
      <p className="muted">
        Members without an authenticator will need to set one up before they can access workspace
        data. Existing sessions must also meet this requirement.
      </p>
      {!canChange && (
        <p className="alert alert-info">
          Set up and verify <Link href="/app/security">your authenticator</Link> before changing
          workspace protection.
        </p>
      )}
      <SubmitButton className="button button-primary" disabled={!canChange}>
        Save protection
      </SubmitButton>
    </ActionForm>
  );
}
