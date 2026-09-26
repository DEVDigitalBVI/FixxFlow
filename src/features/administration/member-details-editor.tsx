import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateMemberDetails } from "@/app/app/people/actions";

type Option = { id: string; name: string; is_active: boolean };
type Profile = { user_id: string; job_title: string | null; department_id: string | null; location_id: string | null; updated_at: string };
export function MemberDetailsEditor({ profile, name, departments, locations }: { profile: Profile; name: string; departments: Option[]; locations: Option[] }) {
  return <details className="settings-editor"><summary>Edit details<span className="sr-only"> for {name}</span></summary>
    <ActionForm action={updateMemberDetails} className="stack">
      <input type="hidden" name="userId" value={profile.user_id}/><input type="hidden" name="updatedAt" value={profile.updated_at}/>
      <div className="field"><label htmlFor={`job-${profile.user_id}`}>Job title</label><input className="input" id={`job-${profile.user_id}`} name="jobTitle" defaultValue={profile.job_title ?? ""} maxLength={120}/></div>
      {([['departmentId', 'Department', departments, profile.department_id], ['locationId', 'Location', locations, profile.location_id]] as const).map(([field, label, options, selected]) => <div className="field" key={field}><label htmlFor={`${field}-${profile.user_id}`}>{label}</label><select className="input" id={`${field}-${profile.user_id}`} name={field} defaultValue={selected ?? ""}><option value="">Not assigned</option>{options.filter(option => option.is_active || option.id === selected).map(option => <option key={option.id} value={option.id}>{option.name}{option.is_active ? '' : ' (inactive)'}</option>)}</select></div>)}
      <SubmitButton className="button button-secondary">Save details</SubmitButton>
    </ActionForm>
  </details>;
}
