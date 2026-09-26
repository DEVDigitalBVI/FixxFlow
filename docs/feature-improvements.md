# Feature improvement rollout

This tracks the feature review and the first implementation batch. Items below marked complete are local implementation work, not a production deployment claim.

## Implemented: administration and intake foundations

- Teams: create, rename, deactivate, and reactivate.
- Categories and subcategories: create, rename, and manage availability without deleting historical ticket references.
- Departments and locations: edit existing details, retaining existing deactivate/reactivate and protected-delete controls.
- People: tenant-scoped name/email search, 25-member pages, and administrator editing of job title, department, and location.
- Existing-record editors compare update timestamps and report conflicts instead of silently overwriting another edit.
- Shared form recovery retains entered values after server or connection failures, focuses the error, and disables controls while saving.
- Ticket creation uses that recovery flow and returns a durable request link on success. General employee requests can include a location; equipment requests retain the asset's location and atomic ticket/asset association.

Existing RLS, update-timestamp triggers, audit triggers, and foreign keys support this batch; no schema migration is needed.

## Remaining work from the review

1. Administration: team membership, organization usage counts, invitation status/resend/revoke and partial-invitation recovery, offboarding reassignment.
2. Ticket intake and work: request templates, attachments during creation, saved queues, reusable replies, resolution summaries, contextual desktop detail drawer, retry idempotency across all creation paths.
3. Service operations: configurable SLA schedules and pause rules, escalation policies, notification preferences and delivery health.
4. Knowledge and assets: article ownership/review dates/version history/internal audience, inventory import and assignment history, QR entry points and warranty reminders.
5. Reporting and platform: date/filter/drill-through reporting, historical metrics, global permission-aware search, operational health, MFA policy and recovery, audit navigation and exports.
6. Expanded workflows: service catalog and approvals, outage communication with linked requests, and satisfaction feedback.

## Verification for this batch

- Unit/render regression coverage for authorization, tenant and version scoping, duplicate-name conflicts, parent-category validation, member assignments, and recoverable ticket failures.
- Browser checks cover live People search, duplicate-name recovery and error focus, native disclosure and keyboard controls, and compact member editing.
- No new sample records or invitation messages were created during browser verification.

## Implemented: routing and suggested guides

- Category administrators can set an active default team. Cross-organization team references are blocked by a composite foreign key. Policy changes are audited.
- New employee and equipment requests use the category default. Staff can select automatic routing, a specific team, or explicitly leave a request unassigned. Inactive categories/teams never receive automatic assignments; policy changes do not reroute existing tickets.
- Ticket history includes an automatic-routing event with the team name captured at creation.
- Ticket intake matches title/description/category against up to 200 recently updated published article summaries in the same organization. It shows at most three relevant guides, keeps matching in the browser, and opens guides in a separate tab to preserve the draft. This is keyword matching, not generated advice; all guides remain accessible through Browse all guides.
- Missing suggestions or unavailable knowledge data never prevent submission.
- Database migrations were applied to the connected Supabase project. No default teams were chosen on behalf of administrators; configure these under Administration → Categories. The frontend still needs deployment.
- Transactional SQL regression covers automatic/manual/unassigned paths, inactive records, cross-tenant references, employee permissions, equipment requests, history and preservation of existing assignments. Fixtures are rolled back.
