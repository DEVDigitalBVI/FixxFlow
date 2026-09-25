import {createClient} from "@/lib/supabase/server";
import {Avatar} from "@/components/ui/avatar";
import type {ReactNode} from 'react';
import {platformIdentity} from '@/lib/auth/platform';
import {BrandLogo} from '@/components/brand/brand-logo';
import {WorkspaceNav} from '@/components/navigation/workspace-nav';
import {signOut} from '@/app/(auth)/actions';
export default async function PlatformLayout({children}:{children:ReactNode}){const owner=await platformIdentity();const db=await createClient();const {data: memberships}=await db.from("organization_memberships").select("organization_id").eq("user_id",owner.id).eq("status","active").limit(1);return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><BrandLogo className="sidebar-logo-full" variant="horizontal" href="/platform"/><BrandLogo className="sidebar-logo-icon" variant="icon" href="/platform"/></div><WorkspaceNav role="administrator" organizationId="" userId={owner.id} platform workspaceAvailable={!!memberships?.length}/><div className="sidebar-account"><Avatar name="Platform owner"/><div className="account-copy"><strong>Platform owner</strong><span>{owner.email}</span></div><form action={signOut}><button className="sign-out-button" type="submit" aria-label="Sign out" title="Sign out"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m7-4 4-4-4-4m4 4H9" /></svg></button></form></div></aside><main className="workspace" id="main-content">{children}</main></div>;}
