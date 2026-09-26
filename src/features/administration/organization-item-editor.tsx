import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { editOrganizationItem } from "@/app/app/organization/actions";

type Item = { id: string; name: string; updated_at: string; description?: string | null; city?: string | null; region?: string | null; country_code?: string | null; timezone?: string };
export function OrganizationItemEditor({ kind, item }: { kind: "departments" | "locations"; item: Item }) {
  const fields = kind === "departments" ? [["description", "Description", item.description, 2000]] as const : [
    ["city", "City", item.city, 100], ["region", "Region", item.region, 100],
    ["countryCode", "Country code", item.country_code, 2], ["timezone", "Timezone", item.timezone, 100],
  ] as const;
  return <details className="settings-editor"><summary>Edit<span className="sr-only"> {item.name}</span></summary>
    <ActionForm action={editOrganizationItem} className="stack">
      <input type="hidden" name="kind" value={kind}/><input type="hidden" name="id" value={item.id}/><input type="hidden" name="updatedAt" value={item.updated_at}/>
      <div className="field"><label htmlFor={`name-${item.id}`}>Name</label><input className="input" id={`name-${item.id}`} name="name" defaultValue={item.name} required maxLength={100}/></div>
      {fields.map(([name, label, value, max]) => <div className="field" key={name}><label htmlFor={`${name}-${item.id}`}>{label}</label><input className="input" id={`${name}-${item.id}`} name={name} defaultValue={value ?? ""} maxLength={max} required={name === "timezone"}/></div>)}
      <SubmitButton className="button button-secondary">Save changes</SubmitButton>
    </ActionForm>
  </details>;
}
