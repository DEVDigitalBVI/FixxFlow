# Notification preferences and daily summaries

Members open **Notifications → Email preferences** to choose **As they happen**, **Daily summary**, or **Off**, a notification timezone, and optional quiet hours. Preferences belong to that member in that organization; administrators cannot read or change another member’s preferences. Existing accounts keep immediate email delivery until they save a different choice. The settings do not change ticket access, SLA clocks, support hours, in-app notifications or notification read state.

Quiet hours support overnight ranges and local daylight-saving changes. Start and end must differ. Delivery resumes after quiet hours, rather than discarding the update. The optional **Send urgent alerts immediately** checkbox (on by default) lets Urgent tickets, SLA warnings and workflow escalations bypass quiet hours and the daily summary. **Off** suppresses routine email even when that checkbox is saved on. Workspace-wide service announcements and account/security emails retain their separate delivery rules.

## Daily summaries

The first summary is scheduled for the next chosen hour in the saved notification timezone. One batch is allowed per due local calendar day. When the chosen hour overlaps quiet hours, the batch waits until they end, including next-morning delivery of an evening summary. A minute-based cron claims bounded batches, so delivery may follow the configured time. Minute-level polling also avoids permanently missing a short allowed window between quiet hours. Only updates created by the scheduled cutoff are included; updates arriving after an empty cutoff wait for the next summary instead of triggering an email later that day. Empty summaries are never sent.

A summary captures up to 100 of the oldest eligible pending email updates, presents the first 10 titles in the shared compact email template, and links to Notifications for the remaining updates. Additional pending rows can be picked up on a later daily slot; deferred updates expire after 72 hours. Previously read updates are omitted under the existing read-state rules, except new-ticket and ownership notifications that intentionally survive reading. No message bodies, internal notes or attachments are copied into the summary.

The existing immediate-email queue retains its payload snapshots, leases, attempt limits and 23-hour retry window. Quiet/digest deferral extends the pre-attempt freshness window to 72 hours. Individual messages that have already been attempted retain their original delivery key when a member switches to daily mode; they are never repackaged into a summary under a second provider key.

Summary batches have their own stable provider idempotency key, five-minute leases, bounded retries, and a 23-hour retry window. Overlapping cron runs cannot split the same recipient’s daily slot or capture the same notification twice. A successful acknowledgement marks its member outbox rows delivered without marking the in-app notifications read. Queue snapshots are immutable during retries.

Before a retry, current organization membership, confirmed email, staff/target permissions, withdrawn announcements, equipment dates and current stock-alert eligibility are checked again. Changing the confirmed email, opting out, leaving the organization, or losing access cancels the captured batch rather than rewriting an already-attempted provider payload. If any captured update becomes ineligible, the whole batch is conservatively skipped; remaining permitted updates remain available in the app. Messages already in flight cannot be recalled.

## Implementation and validation

- Migration: `20261028015209_notification_preferences_and_digests.sql` (local only until the final deployment).
- Preferences: own-row RLS with MFA enforcement, validated timezones and times, optimistic revision checks and a server-verified member identity.
- Delivery: protected `/api/cron/notification-digests`, every minute, using the existing email configuration and shared template. No new provider credentials are required.
- Tests cover private settings and organization isolation, stale edits, DST and overnight scheduling, Off/urgent/quiet behavior, batch deduplication, lease tokens, immutable retries, preference changes during individual retries, revoked membership, safe email rendering and protected cron execution. Native rollback-only checks are in `supabase/tests/database/notification_preferences.test.sql`.
- The organization-isolation sweep now creates valid `time` and `timetz` fixture values, keeping the new table inside the existing catalog-wide RLS checks.
- UI reuses PageHeader, ActionForm, SubmitButton, TimezoneSelect and existing form/surface tokens. A scoped module enforces native hidden controls and checkbox layout; no new colors or design exceptions.

Nothing in this enhancement commits, deploys, changes production preferences or sends a real test email.
