import { ThemeControl } from "@/features/theme/theme-control";
import { OwnerConsoleLink } from "@/features/platform/owner-link";
import { SubmitButton } from "@/components/ui/submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { ViewerAvatar } from "@/features/identity/viewer-avatar";
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

  return <div className="page profile-page">
    <PageHeader title="Your profile" eyebrow="Account" description="Keep your contact and workplace details current." actions={<OwnerConsoleLink className="button button-secondary" />} />
    {message.error && <div className="alert alert-error page-alert" role="alert">{message.error}</div>}
    {message.success && <div className="alert alert-success page-alert" role="status">{message.success}</div>}

    <section className="settings-card profile-card" aria-labelledby="profile-details-heading">
      <header className="profile-card-heading">
        <div className="profile-photo-row">
          <ViewerAvatar name={viewer.displayName} size="large" />
          <div className="profile-photo-copy">
            <span className="section-kicker">Your account</span>
            <h2>{profile?.display_name ?? viewer.displayName}</h2>
            <p>{profile?.email ?? viewer.email}</p>
            <div className="profile-photo-upload"><strong>Profile photo</strong><span className="muted">JPG, PNG, or WebP · Up to 5 MB</span><AvatarUpload organizationId={viewer.organizationId} userId={viewer.id} /></div>
          </div>
        </div>
      </header>
      <form action={updateProfile} className="profile-form">
        <section className="profile-form-section" aria-labelledby="profile-details-heading">
          <div className="profile-form-heading"><h3 id="profile-details-heading">Contact details</h3><p className="muted">How your coworkers can identify and reach you.</p></div>
          <div className="form-grid">
            <div className="field"><label htmlFor="displayName">Display name</label><input className="input" id="displayName" name="displayName" defaultValue={profile?.display_name ?? viewer.displayName} required maxLength={120} /></div>
            <div className="field"><label htmlFor="email">Email</label><input className="input" id="email" value={profile?.email ?? viewer.email} disabled /><small className="muted">Managed by your sign-in settings.</small></div>
            <div className="field"><label htmlFor="jobTitle">Job title</label><input className="input" id="jobTitle" name="jobTitle" defaultValue={profile?.job_title ?? ""} /></div>
            <div className="field"><label htmlFor="phone">Phone</label><input className="input" id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={profile?.phone ?? ""} /></div>
          </div>
        </section>
        <section className="profile-form-section" aria-labelledby="profile-workplace-heading">
          <div className="profile-form-heading"><h3 id="profile-workplace-heading">Workplace</h3><p className="muted">Help your team understand where you work.</p></div>
          <div className="form-grid">
            <div className="field"><label htmlFor="departmentId">Department</label><select className="input" id="departmentId" name="departmentId" defaultValue={profile?.department_id ?? ""}><option value="">Not assigned</option>{departments?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="field"><label htmlFor="locationId">Location</label><select className="input" id="locationId" name="locationId" defaultValue={profile?.location_id ?? ""}><option value="">Not assigned</option>{locations?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          </div>
        </section>
        <div className="profile-form-actions"><SubmitButton className="button button-primary" type="submit">Save profile</SubmitButton></div>
      </form>
    </section>

    <section className="settings-card profile-card appearance-settings" aria-labelledby="appearance-heading">
      <div className="profile-section-heading"><div><h2 id="appearance-heading">Appearance</h2><p className="muted">Choose light or dark mode, or follow your device. Your choice is remembered on this browser.</p></div></div>
      <ThemeControl />
    </section>

    <section className="settings-card profile-card usage-preference" aria-labelledby="usage-heading">
      <div className="profile-section-heading"><div><h2 id="usage-heading">Help improve FixxFlow</h2><p className="muted">Share optional product usage counts. Names, ticket and message contents, and search words are excluded. This is separate from your organization’s reports and audit log.</p></div></div>
      <form action={updateUsagePreference}>
        <label className="usage-choice"><input type="checkbox" name="shareUsage" defaultChecked={viewer.usageSharing} /> Share product usage counts</label>
        <p className="form-note">Off by default. You can stop future collection at any time; previously combined counts cannot be traced back to you for removal.</p>
        <SubmitButton className="button button-secondary" pendingLabel="Saving preference…">Save usage preference</SubmitButton>
      </form>
    </section>
  </div>;
}
