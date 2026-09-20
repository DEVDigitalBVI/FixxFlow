import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { rolePresentation } from "@/features/identity/role";

export default async function PeoplePage() {
  const viewer = await requireViewer(); if (viewer.role === "end_user") notFound();
  const supabase = await createClient();
  const { data: memberships } = await supabase.from("organization_memberships").select("user_id, role, status").eq("organization_id", viewer.organizationId).order("created_at");
  const { data: profiles } = await supabase.from("profiles").select("user_id, display_name, job_title").eq("organization_id", viewer.organizationId);
  const profilesByUser = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  return <div className="page"><header className="page-header"><div><h1>People</h1><p>Organization members, roles, and account access.</p></div></header><div className="table-region" role="region" aria-label="Organization people" tabIndex={0}>{memberships?.length ? <table className="table"><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Job title</th><th scope="col">Access</th></tr></thead><tbody>{memberships.map((membership) => { const profile = profilesByUser.get(membership.user_id); return <tr key={membership.user_id}><td><strong>{profile?.display_name ?? "Profile incomplete"}</strong></td><td>{rolePresentation[membership.role].label}</td><td className="muted">{profile?.job_title ?? "Not set"}</td><td><span className={`badge badge-${membership.status}`}>{membership.status === "active" ? "Active" : "Inactive"}</span></td></tr>; })}</tbody></table> : <div className="empty-state"><strong>No people found</strong><p>Members will appear here after they are added to this organization.</p></div>}</div></div>;
}
