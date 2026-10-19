import { OrganizationCreateForm } from '@/features/administration/organization-create-form';
import { TimezoneSelect } from '@/features/timezones/select';
import { TimezoneSettingsForm } from '@/features/timezones/settings-form';
import { OrganizationItemEditor } from "@/features/administration/organization-item-editor";
import { OrganizationItemActions } from "@/features/administration/organization-item-actions";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { addDepartment, addLocation, toggleDepartment, toggleLocation, deleteDepartment, deleteLocation } from "./actions";
import { PageHeader } from "@/components/ui/page-header";

type Props = { searchParams: Promise<{ error?: string; success?: string }> };
export default async function OrganizationPage({ searchParams }: Props) {
  const viewer = await requireViewer();
  if (viewer.role !== "administrator") notFound();
  const message = await searchParams;
  const supabase = await createClient();
  const [{ data: departments, error: departmentsError }, { data: locations, error: locationsError }] = await Promise.all([
    supabase.from("departments").select("id, name, description, is_active, updated_at").eq("organization_id", viewer.organizationId).order("name"),
    supabase.from("locations").select("id, name, city, region, country_code, timezone, is_active, updated_at").eq("organization_id", viewer.organizationId).order("name"),
  ]);
  return <div className="page"><PageHeader title="Organization" eyebrow="Administration" description="Configure the departments and service locations used throughout FixxFlow." back={{href:"/app/administration",label:"Back to Administration"}}/>{message.success && <div className="alert alert-success page-alert" role="status">{message.success}</div>}{message.error && <div className="alert alert-error page-alert" role="alert">{message.error}</div>}<section className="settings-card profile-card"><h2>Timezone</h2><p className="muted">Reports and shared calendar days use this timezone. Existing deadlines keep their saved instant.</p><TimezoneSettingsForm scope="organization" initial={viewer.organizationTimezone}><TimezoneSelect value={viewer.organizationTimezone}/></TimezoneSettingsForm></section><div className="settings-grid"><section id="departments" className="settings-card"><h2>Departments</h2><p className="muted">Deactivate to hide an entry from new selections while keeping existing links. Delete only entries that are no longer in use.</p><details className="progressive-section"><summary>Add department</summary><OrganizationCreateForm kind="department" action={addDepartment}/></details>{departmentsError ? <p className="alert alert-error" role="alert">Departments could not be loaded. <Link className="button button-secondary" href="/app/organization#departments">Try again</Link>.</p> : !departments?.length && <p className="empty-state">No departments yet.</p>}<div className="management-list">{departments?.map((item) => <div className="management-item" key={item.id}><div><strong>{item.name}</strong><span>{item.is_active ? "Active" : "Inactive"}</span><span>{item.description ?? "No description"}</span></div><OrganizationItemEditor kind="departments" item={item}/><OrganizationItemActions id={item.id} name={item.name} active={item.is_active} kind="department" toggleAction={toggleDepartment} deleteAction={deleteDepartment}/></div>)}</div></section><section id="locations" className="settings-card"><h2>Locations</h2><p className="muted">Deactivate to hide an entry from new selections while keeping existing links. Delete only entries that are no longer in use.</p><details className="progressive-section"><summary>Add location</summary><OrganizationCreateForm kind="location" action={addLocation} timezone={viewer.organizationTimezone}/></details>{locationsError ? <p className="alert alert-error" role="alert">Locations could not be loaded. <Link className="button button-secondary" href="/app/organization#locations">Try again</Link>.</p> : !locations?.length && <p className="empty-state">No locations yet.</p>}<div className="management-list">{locations?.map((item) => <div className="management-item" key={item.id}><div><strong>{item.name}</strong><span>{item.is_active ? "Active" : "Inactive"}</span><span>{[item.city, item.region, item.country_code].filter(Boolean).join(", ") || item.timezone}</span></div><OrganizationItemEditor kind="locations" item={item}/><OrganizationItemActions id={item.id} name={item.name} active={item.is_active} kind="location" toggleAction={toggleLocation} deleteAction={deleteLocation}/></div>)}</div></section></div></div>;
}
