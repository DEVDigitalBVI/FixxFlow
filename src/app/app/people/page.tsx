import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";
import { rolePresentation } from "@/features/identity/role";
import { updateMemberRole, updateMemberStatus } from "./actions";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function PeoplePage({ searchParams }: Props) {
  const viewer = await requireViewer(); if (viewer.role === "end_user") notFound();
  const message = await searchParams;
  const supabase = await createClient();
  const { data: memberships } = await supabase.from("organization_memberships").select("user_id, role, status").eq("organization_id", viewer.organizationId).order("created_at");
  const { data: profiles } = await supabase.from("profiles").select("user_id, display_name, job_title").eq("organization_id", viewer.organizationId);
  const profilesByUser = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
  return <div className="page"><header className="page-header"><div><h1>People</h1><p>Organization members, roles, and account access.</p></div></header>{message.error && <div className="alert alert-error" role="alert" style={{ marginBottom: 16 }}>{message.error}</div>}<div className="table-region" role="region" aria-label="Organization people" tabIndex={0}>{memberships?.length ? <table className="table"><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Job title</th><th scope="col">Access</th><th scope="col">Action</th></tr></thead><tbody>{memberships.map((membership) => { const profile = profilesByUser.get(membership.user_id); return <tr key={membership.user_id}><td><strong>{profile?.display_name ?? "Profile incomplete"}</strong></td><td>{viewer.role === "administrator" ? <form action={updateMemberRole} className="form-row"><input type="hidden" name="userId" value={membership.user_id} /><label className="sr-only" htmlFor={`role-${membership.user_id}`}>Role for {profile?.display_name ?? "member"}</label><select className="input" id={`role-${membership.user_id}`} name="role" defaultValue={membership.role}>{Object.entries(rolePresentation).map(([role, presentation]) => <option key={role} value={role}>{presentation.label}</option>)}</select><button className="button button-secondary" type="submit">Save</button></form> : rolePresentation[membership.role].label}</td><td className="muted">{profile?.job_title ?? "Not set"}</td><td><span className={`badge badge-${membership.status}`}>{membership.status === "active" ? "Active" : "Inactive"}</span></td><td>{viewer.role === "administrator" && <form action={updateMemberStatus}><input type="hidden" name="userId" value={membership.user_id} /><input type="hidden" name="status" value={membership.status === "active" ? "inactive" : "active"} /><button className={`button ${membership.status === "active" ? "button-danger" : "button-secondary"}`} type="submit" disabled={membership.user_id === viewer.id && membership.status === "active"}>{membership.status === "active" ? "Deactivate" : "Activate"}</button></form>}</td></tr>; })}</tbody></table> : <div className="empty-state"><strong>No people found</strong><p>Members will appear here after they are added to this organization.</p></div>}</div></div>;
}
