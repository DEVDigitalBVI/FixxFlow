import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { rolePresentation } from "@/features/identity/role";

export default async function OverviewPage() {
  const viewer = await requireViewer(); const supabase = await createClient();
  const [people, departments, locations] = await Promise.all([
    supabase.from("organization_memberships").select("user_id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId).eq("status", "active"),
    supabase.from("departments").select("id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId).eq("is_active", true),
    supabase.from("locations").select("id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId).eq("is_active", true),
  ]);
  return <div className="page"><header className="page-header"><div><h1>{viewer.organizationName}</h1><p>Organization and identity overview</p></div>{viewer.role === "administrator" && <Link className="button button-secondary" href="/app/people">Manage people</Link>}</header><section className="card-grid" aria-label="Organization metrics"><article className="card"><h2>Active people</h2><p className="metric">{people.count ?? 0}</p><p className="muted">Members with workspace access</p></article><article className="card"><h2>Departments</h2><p className="metric">{departments.count ?? 0}</p><p className="muted">Active organizational groups</p></article><article className="card"><h2>Locations</h2><p className="metric">{locations.count ?? 0}</p><p className="muted">Active service locations</p></article></section><section className="card" style={{ marginTop: 16 }}><h2>Your access</h2><p><strong>{rolePresentation[viewer.role].label}</strong></p><p className="muted">{rolePresentation[viewer.role].description}</p></section></div>;
}
