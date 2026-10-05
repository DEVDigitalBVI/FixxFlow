import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveClassification } from "@/app/app/administration/actions";

type Item = { id: string; name: string; is_active: boolean; updated_at: string; default_team_id?: string | null };
export function ClassificationEditor({ kind, item, categoryId, teams = [] }: {
  kind: "teams" | "ticket_categories" | "ticket_subcategories";
  item?: Item;
  categoryId?: string;
  teams?: { id: string; name: string; is_active: boolean }[];
}) {
  const label = kind === "teams" ? "team" : kind === "ticket_categories" ? "category" : "subcategory";
  const key = item?.id ?? `new-${kind}-${categoryId ?? ""}`;
  return <ActionForm action={saveClassification} className="stack" resetOnSuccess={!item}>
    <input type="hidden" name="kind" value={kind}/>
    {item && <><input type="hidden" name="id" value={item.id}/><input type="hidden" name="updatedAt" value={item.updated_at}/></>}
    {categoryId && <input type="hidden" name="categoryId" value={categoryId}/>}
    <div className="field"><label htmlFor={`name-${key}`}>{item ? `Name of ${label}` : `New ${label} name`}</label><input id={`name-${key}`} name="name" className="input" required maxLength={100} defaultValue={item?.name}/></div>
    {item ? <div className="field"><label htmlFor={`active-${key}`}>Availability</label><select id={`active-${key}`} name="isActive" className="input" defaultValue={String(item.is_active)}><option value="true">Active</option><option value="false">Inactive</option></select></div> : <input type="hidden" name="isActive" value="true"/>}
    {kind === "ticket_categories" && <div className="field"><label htmlFor={`team-${key}`}>Default team for new tickets</label><select className="input" id={`team-${key}`} name="defaultTeamId" defaultValue={item?.default_team_id ?? ""} aria-describedby={`routing-${key}`}><option value="">No default · leave unassigned</option>{teams.filter(team => team.is_active || team.id === item?.default_team_id).map(team => <option key={team.id} value={team.id} disabled={!team.is_active}>{team.name}{team.is_active ? "" : " (inactive — choose another team)"}</option>)}</select><small className="muted" id={`routing-${key}`}>Applies to new tickets only. Staff can override routing. Inactive teams receive no automatic assignments.</small></div>}
    <SubmitButton className={`button ${item ? "button-secondary" : "button-primary"}`}>{item ? `Save ${label}` : `Add ${label}`}</SubmitButton>
  </ActionForm>;
}
