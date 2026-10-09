import type { ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { SubmitButton } from '@/components/ui/submit-button';
import { rolePresentation } from '@/features/identity/role';
import { MemberDetailsEditor } from '@/features/administration/member-details-editor';
import type { AppRole, MembershipStatus } from '@/types/database';

type Profile = { user_id: string; job_title: string | null; department_id: string | null; location_id: string | null; updated_at: string };
type Option = { id: string; name: string; is_active: boolean };
export function PersonCard({ id, name, email, avatarUrl, role, status, isSelf, canManage, profile, departments, locations, updateRole, updateStatus, inventoryPermissions }: {
  id: string; name: string; email: string; avatarUrl?: string | null; role: AppRole; status: MembershipStatus;
  isSelf: boolean; canManage: boolean; profile?: Profile; departments: Option[]; locations: Option[];
  inventoryPermissions?: ReactNode;
  updateRole: (form: FormData) => Promise<void>; updateStatus: (form: FormData) => Promise<void>;
}) {
  return <li className="person-card">
    <div className="person-card-overview">
      <div className="person-card-identity"><Avatar name={name} src={avatarUrl}/><div><h3>{name}{isSelf && <span className="person-self">You</span>}</h3><p>{email}</p>{profile?.job_title && <p className="person-job">{profile.job_title}</p>}</div></div>
      <div className="person-card-meta"><span className="person-role">{rolePresentation[role].label}</span><span className={`badge badge-${status}`}><span className="status-dot" aria-hidden="true"/>{status === 'active' ? 'Active' : 'Inactive'}</span></div>
    </div>
    {canManage && <details className="person-manage"><summary className="button button-secondary">Manage<span className="sr-only"> {name}</span><span aria-hidden="true">⌄</span></summary>
      <div className="person-manage-content">
        <section className="stack" aria-labelledby={`person-details-${id}`}><h4 id={`person-details-${id}`}>Profile details</h4><p className="muted">Keep their role in the organization up to date.</p>{profile ? <MemberDetailsEditor inline profile={profile} name={name} departments={departments} locations={locations}/> : <p className="muted">Profile details will be available when this member finishes setting up their account.</p>}</section>
        <section className="stack" aria-labelledby={`person-access-${id}`}><h4 id={`person-access-${id}`}>Workspace access</h4><p className="muted">{rolePresentation[role].description}</p>
          <form action={updateRole} className="stack"><input type="hidden" name="userId" value={id}/><div className="field"><label htmlFor={`role-${id}`}>Role for {name}</label><select id={`role-${id}`} className="input" name="role" defaultValue={role}>{Object.entries(rolePresentation).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></div><SubmitButton className="button button-secondary">Save role<span className="sr-only"> for {name}</span></SubmitButton></form>
          <div className="person-access-change">{isSelf && status === 'active' ? <p className="muted">You can’t deactivate your own account.</p> : <details className="settings-editor"><summary>{status === 'active' ? 'Deactivate access' : 'Restore access'}<span className="sr-only"> for {name}</span></summary><form action={updateStatus} className="stack"><input type="hidden" name="userId" value={id}/><input type="hidden" name="status" value={status === 'active' ? 'inactive' : 'active'}/><p>{status === 'active' ? `Deactivate ${name}’s workspace access? Their existing records will be retained.` : `Restore ${name}’s workspace access? Their current role will be retained.`}</p><SubmitButton className={`button ${status === 'active' ? 'button-danger' : 'button-secondary'}`}>{status === 'active' ? 'Confirm deactivation' : 'Restore access'}</SubmitButton></form></details>}</div>
        </section>
        {inventoryPermissions}
      </div>
    </details>}
  </li>;
}
