# People and authentication enhancements

These changes are uncommitted and are not enabled in production.

## CSV invitations

Administrators open **People → Invite from CSV**. Upload a UTF-8 CSV with Email and Name headers and an optional Role column. Employee is the default; Technician and Administrator are explicit choices. Limits are 100 people and 200 KB. Preview the names, emails and requested roles before sending.

All rows are validated before preview, and each server group is revalidated before sending. Duplicate emails, unknown roles, invalid names/emails and extra columns are rejected. The server derives the workspace and actor from the verified session, and never accepts a caller-supplied organization. Current members are recognized within that workspace and are left unchanged, including their role and active/inactive status.

The browser submits groups of five through the existing single-member invitation workflow, retaining a separate stable invitation key for every person. The existing durable invitation preparation/completion receipts prevent duplicate emails on uncertain retries. Progress and per-row results remain visible. Sending stops after a group with errors or a network uncertainty; retry the remaining rows or skip a failed row. Stop after this group finishes the in-flight group before pausing. Successful rows are not sent again. Choosing a different CSV starts a new preview; unfinished drafts warn before navigation.

Existing accounts are never reassigned to another organization, and invitations do not silently change existing roles. This reuses the established invitation email and account setup flow. No real invitations were sent during validation.

## Workspace-enforced MFA

**Administration → Security** now provides the workspace requirement. An administrator must have a verified authenticator and a current AAL2 session before enabling or disabling it. Policy changes use optimistic revision checks and are audited. The requirement is off by default, so deployment does not force enrollment without an administrator choosing it.

When enabled, active members without a factor are routed to `/auth/enroll`; members with a factor but without AAL2 are routed to the existing challenge page. Existing sessions are subject to the requirement on their next data request. The bootstrap RPC exposes only the calling account’s required/enrolled booleans, allowing setup without revealing workspace data.

Enforcement covers restrictive table policies and the central member/role helpers used by definer RPCs. A required account needs both an AAL2 token and a currently verified factor. Removing the last factor therefore blocks even a previously issued AAL2 token. The UI prevents removal of the last factor in a required workspace and encourages a verified backup. Disabling the workspace requirement retains the existing protection for members who individually enrolled MFA. Trusted maintenance operations without a human subject retain their established behavior.

The enrollment flow supports native form submission, digit-only verification codes, pending guards, recoverable errors, accessible feedback, and a compact layout inside the sign-in card. Losing all authenticators requires recovery through established support procedures; a password reset does not bypass MFA.

Migration: `20261028023022_workspace_authentication_policy.sql`. Applied and recorded locally only. Other pending feature migrations were left untouched.

## Microsoft and Google company sign-in

The application code supports Microsoft Entra (`azure`) and Google OAuth sign-in through the existing PKCE callback. Buttons appear only when the corresponding server flag is explicitly enabled and the canonical site URL is valid. Password sign-in remains available. The server fixes both provider and callback; authorization redirects must stay on the configured Supabase Auth endpoint. The flow requests no calendar, mail, contacts or offline access. Workspace membership and roles still come from invitations and the database, not provider metadata or a matching domain.

This is shared company sign-in through Supabase OAuth, not a per-workspace SAML provisioning system. Unknown accounts cannot acquire workspace membership by signing in. Supabase manages verified identity linking; the application does not merge accounts by email.

### Final rollout configuration still required

No live provider was configured or activated during this build.

1. Configure a Microsoft Entra OAuth app and/or Google OAuth client using the Supabase project’s Auth callback URL, `https://<project-ref>.supabase.co/auth/v1/callback`. Store provider credentials in Supabase Auth, never in client code or public app variables.
2. For Microsoft, choose the intended work-account tenant scope and configure the `email` and recommended `xms_edov` claims. The application requests the `email` scope. Review Microsoft’s tenant consent requirements before making the provider available.
3. Configure Google’s consent screen, audience and web client as required for the chosen Google Workspace accounts.
4. Allow `https://fixxflow.com/auth/callback` in Supabase redirect URLs. Keep existing invitation/recovery redirects.
5. Set `AUTH_MICROSOFT_ENABLED=true` and/or `AUTH_GOOGLE_ENABLED=true` only after the matching provider is ready; both default to false in `.env.example`.
6. During final rollout, verify a real invited Microsoft and Google account, inactive/unassigned denial, callback cancellation and required MFA. Provider credentials and tenant consent are necessary for this live check.

Setup references: [Supabase Microsoft/Entra guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-azure), [Supabase Google guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).

## Validation

Tests cover CSV parsing and bounded server execution, trusted invitation keys/organization scope, company login flags and callback restrictions, required enrollment/challenge routing, last-factor protection, stale policy edits, audit behavior, tenant isolation and existing-session denial. Native rollback checks are in `supabase/tests/database/workspace_authentication_policy.test.sql`.

A separate real local Supabase Auth smoke test created a disposable account/workspace, enforced enrollment, enrolled and verified a real TOTP factor, confirmed AAL2 data access and policy changes, then removed the factor and confirmed an old AAL2 token could no longer read workspace data. The disposable account/workspace were removed. No email was sent.

UI reuses shared headers, forms, buttons, role labels, table/card behavior and authenticator components. Light/dark and desktop/phone previews use real components with dummy data; no live provider consent or invitation action is exercised by those previews. No design-system exception is intended.

## Final UI consistency review

Microsoft/Google buttons use official locally hosted marks and provider typography in an equally sized light treatment, including on dark pages. The Google font is a small button-text-only subset with its OFL license. This user-requested branding exception is documented in `DESIGN_SYSTEM.md`.

The employee rating and satisfaction components retain the shared portal/reporting patterns. The platform retention card now keeps its technical schedule behind a native disclosure, the export card explicitly says “Export organization accounts,” and shared export controls use unique label/hint IDs when more than one is rendered. The export is currently account metadata and aggregate totals, not a full customer ticket/message/asset export; that functional scope remains distinct from this UI review.
