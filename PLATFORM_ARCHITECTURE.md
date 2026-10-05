# FixxFlow platform architecture

FixxFlow is one Next.js application with shared Postgres services, tenant-scoped records, and distinct employee, technician, customer-administrator and platform-owner experiences.

| Experience | Entry point | Access |
| --- | --- | --- |
| Employee portal | `/app` | Active `end_user` membership; own requests, chats and assigned equipment; published help articles. |
| Technician workspace | `/app` | Active technician or administrator membership; organization tickets, chats, knowledge, assets and reports. |
| Customer administration | `/app/administration` | Organization administrator; people and access, organization settings and tenant audit. |
| Platform owner console | `/platform` | Explicit private owner membership, an existing non-expired Auth session, verified MFA factor and `aal2`. Independent of customer membership. |

Tickets, chat and knowledge share identity, organization isolation, notifications and operational reporting. Users and permissions underpin all modules. Audit records observe significant business changes; opt-in product analytics observe a restricted set of usage events. These are cross-cutting services, not a sequential request pipeline.

## Asset inventory

- IT staff create and update equipment at `/app/assets`: unique organization asset tag, name, type, lifecycle, serial/model, assigned employee, location, purchase and warranty dates.
- Employee `My equipment` lists only assets assigned to the current active member. Detail fields are intentionally employee-visible; do not store internal secrets in them.
- Search covers name, tag, serial and model using indexed full-text search. Lists use server filtering and 25-row pagination.
- Lifecycle states: Available, In use, Under repair, Retired. Retirement requires unassignment and preserves history. There is no destructive asset delete endpoint.
- Updates use a revision predicate to detect concurrent edits and preserve drafts on failure.
- Staff link and unlink equipment from the ticket's Linked assets section. Composite foreign keys reject cross-organization links.
- Employees can start a request from equipment details. The checked RPC creates a ticket and its asset link atomically, verifies current assignment, and derives the requester from the session.
- Customer audit includes asset changes and ticket associations. Existing product analytics now accepts authorized `asset_viewed` events with the same opt-in and daily dedup rules.

## Platform operations

`/platform/customers` lists and searches organizations with active member counts, creates new customer organizations, and edits organization names. Creation uses a verified, unassigned account as the customer's administrator, preserving the existing organization bootstrap and seeding rules. This workflow does not send email or impersonate customers. A customer may also use existing self-service onboarding.

`/platform/analytics` shows aggregate opt-in feature counts over 7, 30 or 90 UTC days, including event and role breakdowns. No per-customer/person journey is available. Zero counts are a valid empty state.

`/platform/audit` shows the latest 50 platform operations with actor and time. Owner changes commit together with their audit events. Rows are append-only to application users.

The console uses authenticated clients and narrow checked database functions. No service credential is sent to a browser or used to bypass customer RLS. Platform owners do not inherit customer ticket, chat, knowledge or asset access. Those require a separate active tenant membership.

### Owner provisioning

Owner grants are an operator-controlled operation, not a customer-admin feature. Verify the exact account and email before adding its user UUID to `private.platform_owners`. Do not use a public email allowlist or editable user metadata. Record the grant in `private.platform_audit`. Revoking the private membership takes effect on the next database request; a stale JWT cannot preserve access.

A signed-in owner without a tenant is routed from `/app` or onboarding to `/platform`. Owners with a customer membership can use the Profile link. `/platform/access` provides the existing authenticator enrollment/challenge flows. No customer data is returned until MFA is complete.

No billing, tenant suspension, impersonation, owner delegation UI, inventory discovery agent, purchasing workflow, or asset file storage is introduced by this initial hierarchy build. Existing fixed SLA policies and read-only category/team settings retain their documented behavior.

## Verification

- `npm test`: validation, tenant-derived mutations, stale-edit handling, form semantics, owner gate and analytics aggregation.
- `supabase/tests/assets_and_platform.sql`: rollback-only synthetic users, organizations, sessions and factors; employee/tenant isolation, immutable identity, equipment requests, asset view deduplication, owner MFA and revocation, create/rename operations, customer privacy and audit recording.
- `npm run lint`, `npm run typecheck`, `npm run build`.
- New screens reuse workspace/portal shells, responsive tables, navigation focus management, forms, SubmitButton and reporting bars. No new design tokens or UI dependencies.
