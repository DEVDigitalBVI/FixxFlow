# Pilot verification — 16 October 2026 (America/Tortola)

## Decision

The corrected working tree passes local pilot acceptance. The hosted pilot is **not
cleared to start** until the release and operational gates below are closed.
Verification ran on 17 October UTC (16 October locally), starting from clean commit
`ccb52ced264da5ba31d4f58868715027008bbfd3`. Corrections are uncommitted and undeployed.

## Verified results

| Check | Result |
| --- | --- |
| Node 24 application tests after corrections | 871 passed; zero failures/skips |
| ESLint with zero warnings; generated route types and TypeScript | Passed |
| Node 24 optimized production build and session-refresh proxy verification | Passed |
| Local PostgreSQL 17 schema lint | No errors |
| Local pgTAP | Five files, 33 assertions passed |
| Transactional local SQL regressions | All 16 files passed |
| Authenticated Chromium workflows against the local production build | 13 passed |
| Additional local password recovery acceptance | Passed |
| Public production smoke at 2026-10-17 01:54:43 UTC | Liveness 200, root 307, login 200, required security headers passed |
| Production Supabase project | `ACTIVE_HEALTHY`; PostgreSQL 17.6.1.166 |
| Production database automation gate | `active = false` |

The 13 browser checks covered incorrect-password recovery; employee ticket creation;
attachment upload, registration and byte-for-byte download; technician assignment;
public replies and internal-note isolation in live/history views; in-app notification
creation; conflicting staff edits with retained drafts; resolution/reopening; two-user
chat; offline/reconnect reconciliation with an unsent draft; compact employee reflow
and navigation focus; invitation email/acceptance/password setup/sign-in; and MFA
challenge rejection/recovery. Password recovery separately covered the local email,
PKCE callback, password update and sign-in with the new password.

Browser fixtures used synthetic accounts and a dedicated synthetic organization in
local Supabase, local Mailpit, disabled automation, and disabled Resend delivery.
Final browser contexts blocked external HTTP requests. No production migrations,
business-record mutations, email sends, deployments or feature activation were made.
Sanitized final browser evidence is in
[`pilot-verification-2026-10-16-results.json`](pilot-verification-2026-10-16-results.json).

## Defects found and corrected

### Ticket message audience could disagree with the selected radio

After a successful public reply, React's form-action reset restored the native radio
to the initial internal-note selection while React state, hidden `kind`, audience
text and submit action remained public. Selecting an already checked internal-note
radio then did not fire a change event. This was reproduced in the production build.

The composer now uses the same prevented native-submit pattern as `ActionForm` and
chat, leaving the existing controlled audience/draft state in charge. It clears only
the successfully submitted draft. Regression coverage checks separate drafts,
duplicate-submit protection, audience selection, and retained drafts on failure.
The browser now successfully sends a public reply, switches to a private note, and
confirms that the employee cannot see the note in either view.

### New invitations could not reach password setup

The standard invitation `ConfirmationURL` produced a session in the URL fragment.
The server callback accepted only a PKCE `code`, so a fresh recipient reached an
invalid-link login page instead of password setup. Supabase documents this distinction
and recommends server-side `verifyOtp` for customized invitation links.
[Provider documentation](https://supabase.com/docs/guides/auth/auth-email-templates#redirecting-the-user-to-a-server-side-endpoint).

The generated invitation now uses `SiteURL`, `TokenHash` and `type=invite` directly
at the callback. The callback verifies the one-use token with Supabase, establishes
the SSR cookie session, and always sends successful invitations to password setup.
Other PKCE callbacks retain their behavior. Tests cover expired/replayed tokens,
unsupported/ambiguous tokens and untrusted redirect parameters. Local Auth now uses
the actual generated invite template and a localhost default URL. The full browser
invitation and existing password-reset flows both pass.

**Release dependency:** deploy the callback before replacing the hosted **Invite
user** email template with `supabase/templates/invite-user.html`. The hosted template
was not changed. Previously sent default invitation links are not repaired by this
source change; provide a supported recovery path for existing recipients.

## Hosted release and operational gates

1. **Deploy the corrected candidate and update the hosted invitation template.**
   Pin the new commit and migration hashes, require fresh CI, verify the exact
   deployment's protected readiness/release identity, and record authenticated hosted
   acceptance with an explicitly authorized pilot recipient. Local Mailpit acceptance
   does not prove current production SMTP/Resend delivery.
2. **Apply the already reviewed pending report migration through the release process.**
   The production ledger has 48 versions versus 49 locally. An explicitly targeted
   `supabase db push --dry-run --skip-vault --project-ref dhuikxkrokowvnvzpihp`
   reported exactly `20261016120000_fix_next_report_run_month_end.sql`, no seeds and
   no roles. A read-only production call to the monthly scheduler failed with
   SQLSTATE `22007` because the deployed function uses invalid interval text
   `1 month-1 day`. The local migration and month-end/leap-year regressions pass.
   No migration was applied to production during this review.
3. **Establish the monitoring detection target with observed evidence.**
   The latest three scheduled `Production health` runs started at 2026-10-16
   20:54:06 UTC, 23:26:34 UTC and 2026-10-17 01:28:20 UTC. All succeeded, including
   protected database readiness in the latest job, but the observed gaps were
   approximately 152 and 122 minutes. At 02:44 UTC the latest run was about 76 minutes
   old. A four-times-hourly cron declaration alone does not establish the approved
   25-minute detection objective. Verify another dependable external health/alert
   path or improve monitoring and measure its cadence and alert routing.
4. **Complete the hosted backup restore rehearsal.**
   The existing same-day backup inventory and local logical restore evidence remain
   useful, but neither proves the four-hour hosted recovery target or Storage-object
   recovery. A disposable provider-backed clone requires a cost quote/approval and
   an isolation procedure established before copied cron or outbound integrations
   can run. Do not start an unfenced physical clone. After isolation, time restore,
   verify migration/data/permission integrity, reconnect an isolated application,
   exercise core flows, and retain smoke evidence before approving cleanup.
5. **Keep automation processing disabled.**
   The database gate was freshly verified OFF. Hosted cron/activation acceptance and
   the environment processing gate still need their separate release verification.

## CI and access evidence

The baseline commit has successful [Checks](https://github.com/DEVDigitalBVI/FixxFlow/actions/runs/38991892606)
and [CodeQL](https://github.com/DEVDigitalBVI/FixxFlow/actions/runs/38991892613).
Its Vercel commit status is successful and points to deployment
`FFAKztESuPG3k8BCp6aKb9VN7myq`. These statuses do not cover the new uncommitted fixes.

The latest observed [Production health run](https://github.com/DEVDigitalBVI/FixxFlow/actions/runs/38990995319)
passed its protected readiness/database probe at 01:28 UTC. It checked the canonical
site but did not assert an expected release SHA. Direct Vercel metadata reads returned
HTTP 403 for both available team contexts, so this review could not independently
bind the current canonical domain to an immutable deployment or inspect its environment
configuration. No attempt was made to bypass that denial or disclose secrets.

## Acceptance limits and design alignment

These are functional local production-build checks, not hosted acceptance, capacity
testing or an accessibility certification. A first chat check sent before subscription
readiness and timed out; reconnect/focus reconciliation recovered the saved message.
The final realtime check waited for both rooms to report Live and passed. This does
not establish delivery latency during subscription startup or under load.

Reused the existing message presentation mapping, controlled separate drafts, native
radio/buttons, focus behavior, email renderer and established design tokens. Verified
390px employee reflow, keyboard Escape/focus restoration and reduced-motion rendering
in Chromium. VoiceOver speech, physical devices, all browser engines, forced colors,
and a new 200% zoom pass were not exercised. No deliberate design-system exception.
