import Link from "next/link";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { rolePresentation } from "@/features/identity/role";
import { Avatar } from "@/components/ui/avatar";

export default async function OverviewPage() {
  const viewer = await requireViewer(); const supabase = await createClient();
  const [people, departments, locations] = await Promise.all([
    supabase.from("organization_memberships").select("user_id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId).eq("status", "active"),
    supabase.from("departments").select("id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId).eq("is_active", true),
    supabase.from("locations").select("id", { count: "exact", head: true }).eq("organization_id", viewer.organizationId).eq("is_active", true),
  ]);
  return <div className="page"><header className="page-header"><div><span className="page-eyebrow">Workspace overview</span><h1>{viewer.organizationName}</h1><p>People, access, and organization readiness at a glance.</p></div>{viewer.role === "administrator" && <Link className="button button-secondary" href="/app/people">Manage people <span aria-hidden="true">→</span></Link>}</header><section className="welcome-card"><div><span className="eyebrow">Welcome back</span><h2>{viewer.displayName}</h2><p>Your FixxFlow workspace is ready. Keep your organization details current as the team grows.</p></div><Avatar name={viewer.displayName} src={viewer.avatarUrl} size="large" /></section><section className="card-grid" aria-label="Organization metrics"><article className="metric-card"><div className="metric-icon metric-icon-blue" aria-hidden="true">01</div><div><h2>Active people</h2><p className="metric">{people.count ?? 0}</p><p className="muted">Members with workspace access</p></div></article><article className="metric-card"><div className="metric-icon metric-icon-cyan" aria-hidden="true">02</div><div><h2>Departments</h2><p className="metric">{departments.count ?? 0}</p><p className="muted">Active organizational groups</p></div></article><article className="metric-card"><div className="metric-icon metric-icon-purple" aria-hidden="true">03</div><div><h2>Locations</h2><p className="metric">{locations.count ?? 0}</p><p className="muted">Active service locations</p></div></article></section><section className="access-card"><div><span className="section-kicker">Your access</span><h2>{rolePresentation[viewer.role].label}</h2><p>{rolePresentation[viewer.role].description}</p></div><span className="badge badge-active">Active</span></section></div>;
}
