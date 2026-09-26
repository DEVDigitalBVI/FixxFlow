import Link from "next/link";
import { SubmitButton } from "@/components/ui/submit-button";

type Props = {
  id: string;
  name: string;
  active: boolean;
  kind: "department" | "location";
  toggleAction: (form: FormData) => Promise<void>;
  deleteAction: (form: FormData) => Promise<void>;
};

export function OrganizationItemActions({ id, name, active, kind, toggleAction, deleteAction }: Props) {
  return <div className="organization-item-actions">
    <form action={toggleAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="isActive" value={String(active)} />
      <SubmitButton className="button button-small button-secondary" aria-label={`${active ? "Deactivate" : "Activate"} ${kind} ${name}`}>{active ? "Deactivate" : "Activate"}</SubmitButton>
    </form>
    <details className="organization-delete">
      <summary>Delete<span className="sr-only"> {kind} {name}</span>…</summary>
      <form action={deleteAction} className="stack">
        <input type="hidden" name="id" value={id} />
        <p id={`delete-description-${id}`}>Permanently delete “{name}”? This cannot be undone. Linked records will block deletion; deactivate the {kind} to keep its history.</p>
        <label className="organization-delete-confirm"><input type="checkbox" name="confirmDelete" value={id} required aria-describedby={`delete-description-${id}`} />I confirm permanent deletion of {name}.</label>
        <SubmitButton className="button button-small button-danger" pendingLabel="Deleting…">Delete {kind}</SubmitButton>
        <Link className="button button-quiet" href={`/app/organization#${kind === "department" ? "departments" : "locations"}`}>Cancel</Link>
      </form>
    </details>
  </div>;
}
