import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DisclosureActionForm } from '@/components/ui/disclosure-action-form';
import { SubmitButton } from '@/components/ui/submit-button';

type Props = {
  id: string;
  name: string;
  active: boolean;
  kind: 'department' | 'location';
  toggleAction: (form: FormData) => Promise<void>;
  deleteAction: (form: FormData) => Promise<void>;
};

export function OrganizationItemActions({
  id,
  name,
  active,
  kind,
  toggleAction,
  deleteAction,
}: Props) {
  const deactivationHint = active && (
    <small className="muted" id={`deactivate-description-${id}`}>
      Hidden from new selections. Existing records stay linked.
    </small>
  );
  return (
    <div className="organization-item-actions">
      <div className="organization-item-toggle">
        <DisclosureActionForm action={toggleAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="isActive" value={String(active)} />
          <SubmitButton
            variant="secondary"
            size="small"
            aria-label={`${active ? 'Deactivate' : 'Activate'} ${kind} ${name}`}
            aria-describedby={active ? `deactivate-description-${id}` : undefined}
          >
            {active ? 'Deactivate' : 'Activate'}
          </SubmitButton>
        </DisclosureActionForm>
        {kind === 'department' && deactivationHint}
      </div>
      <details className="organization-delete">
        <summary>
          Delete
          <span className="sr-only">
            {' '}
            {kind} {name}
          </span>
          …
        </summary>
        <DisclosureActionForm action={deleteAction} className="stack">
          <input type="hidden" name="id" value={id} />
          <p id={`delete-description-${id}`}>
            Permanently delete “{name}”? This cannot be undone. Linked records will block deletion;
            deactivate the {kind} to keep its history.
          </p>
          <label className="organization-delete-confirm">
            <Checkbox
              name="confirmDelete"
              value={id}
              required
              aria-describedby={`delete-description-${id}`}
            />
            I confirm permanent deletion of {name}.
          </label>
          <SubmitButton variant="danger" size="small" pendingLabel="Deleting…">
            Delete {kind}
          </SubmitButton>
          <Link
            className={buttonVariants({ variant: 'quiet' })}
            href={`/app/organization#${kind === 'department' ? 'departments' : 'locations'}`}
          >
            Cancel
          </Link>
        </DisclosureActionForm>
      </details>
      {kind === 'location' && deactivationHint}
    </div>
  );
}
