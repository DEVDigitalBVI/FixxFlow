import { OwnerConsoleLink } from "@/features/platform/owner-link";
import { SubmitButton } from "@/components/ui/submit-button";
import { Avatar } from "@/components/ui/avatar";
import { AvatarUpload } from "@/features/identity/avatar-upload";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { updateProfile, updateUsagePreference } from "./actions";

type Props = { searchParams: Promise<{ error?: string; success?: string }> };

export default async function ProfilePage({ searchParams }: Props) {
  const viewer = await requireViewer();
  const message = await searchParams;
  const supabase = await createClient();
  const [{ data: profile }, { data: departments }, { data: locations }] = await Promise.all([
    supabase.from("profiles").select("display_name, email, job_title, phone, department_id, location_id").eq("organization_id", viewer.organizationId).eq("user_id", viewer.id).single(),
    supabase.from("departments").select("id, name").eq("organization_id", viewer.organizationId).eq("is_active", true).order("name"),
    supabase.from("locations").select("id, name").eq("organization_id", viewer.organizationId).eq("is_active", true).order("name"),
  ]);

  return <div className="page"><header className="page-header"><div><span className="page-eyebrow">Account</span><h1>Your profile</h1><OwnerConsoleLink/><p>Keep your contact and workplace details current.</p></div></header>{message.error && <div className="alert alert-error page-alert" role="alert">{message.error}</div>}{message.success && <div className="alert alert-success page-alert" role="status">{message.success}</div>}<section className="settings-card"><div className="profile-photo-row"><Avatar name={viewer.displayName} src={viewer.avatarUrl} size="large" /><div><strong>Profile photo</strong><p className="muted">JPG, PNG, or WebP. Maximum 5 MB.</p><AvatarUpload organizationId={viewer.organizationId} userId={viewer.id} /></div></div><form action={updateProfile} className="form-grid"><div className="field"><label htmlFor="displayName">Display name</label><input className="input" id="displayName" name="displayName" defaultValue={profile?.display_name ?? viewer.displayName} required maxLength={120} /></div><div className="field"><label htmlFor="email">Email</label><input className="input" id="email" value={profile?.email ?? viewer.email} disabled /></div><div className="field"><label htmlFor="jobTitle">Job title</label><input className="input" id="jobTitle" name="jobTitle" defaultValue={profile?.job_title ?? ""} /></div><div className="field"><label htmlFor="phone">Phone</label><input className="input" id="phone" name="phone" type="tel" defaultValue={profile?.phone ?? ""} /></div><div className="field"><label htmlFor="departmentId">Department</label><select className="input" id="departmentId" name="departmentId" defaultValue={profile?.department_id ?? ""}><option value="">Not assigned</option>{departments?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="field"><label htmlFor="locationId">Location</label><select className="input" id="locationId" name="locationId" defaultValue={profile?.location_id ?? ""}><option value="">Not assigned</option>{locations?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="form-actions"><SubmitButton className="button button-primary" type="submit">Save profile</SubmitButton></div></form></section><section className="settings-card usage-preference"><h2>Help improve FixxFlow</h2><p className="muted">Optionally share counts of the features you use with the FixxFlow product team. Names, ticket and message contents, and search words are excluded. This is separate from your organization’s reports and audit log.</p><form action={updateUsagePreference}><label className="usage-choice"><input type="checkbox" name="shareUsage" defaultChecked={viewer.usageSharing}/> Share product usage counts</label><p className="form-note">Off by default. You can stop future collection at any time; previously combined counts cannot be traced back to you for removal.</p><SubmitButton className="button button-secondary" pendingLabel="Saving preference…">Save usage preference</SubmitButton></form></section></div>;
}
