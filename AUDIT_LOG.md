# Audit log

Administration → Audit Log now reads the append-only organization audit stream. The existing ticket activity timeline remains intact.

## Recorded from enablement onward

Database triggers capture creation, deletion and significant updates for tickets, member access, organizations, profiles (name/department/location), departments, locations, teams, categories, subcategories, knowledge articles, support chats (status/assignment/ticket links), and ticket replies/internal notes (metadata only).

Each entry stores the actor ID and name, target ID and label, timestamp, operation and every changed allowlisted field. Related names are resolved at write time. Deleted targets and later renames do not erase the stored event labels. Updates containing multiple meaningful changes produce one entry with all changes. Timestamp-only and other no-op updates are ignored. A failed business transaction rolls back its audit entries too.

Message bodies, descriptions, article bodies, storage paths and related-article content are represented only by a change marker. Credentials, emails, tokens and attachment contents are not collected. Ticket and article titles remain visible to authorized administrators.

Invitations still use Supabase's existing server-side email invitation API. The membership/profile writes now complete atomically through a service-role-only RPC, which verifies the initiating administrator and records their identity. If email delivery succeeds but database registration fails, the action clearly reports the partial failure. Auth email delivery itself is outside the database transaction.

## Access and scope

- Only active organization administrators can read records, enforced both by route authorization and database RLS.
- Authenticated application users have SELECT only; they cannot fabricate, edit or delete events. Update/delete triggers also reject normal privileged DML. This is application-level append-only history, not external tamper-proof archival against a database owner.
- Trigger helpers live in the private schema, have empty search paths, and cannot be executed directly by clients. Their privileged execution is necessary to append events without granting application users audit INSERT permission.
- Automatic/system mutations without an authenticated actor are marked System. Trusted service-role invitation registration supplies the verified initiator.
- Existing historical actions are not backfilled. Sign-ins, password/MFA changes, email delivery outcomes, file uploads and settings managed outside these database tables are not captured by this V1 stream.
- No automatic retention/purge is configured yet.

## UI and validation

The timeline shows before/after values, BVI timestamps, search by actor/item, area/action filters and 50-event pagination. Existing controls, badges, tokens and ticket/role label mappings are reused. The employee portal gains no audit controls.

`supabase/tests/audit_log.sql` tests multi-field capture, actor snapshots, no-op suppression, content exclusion, administrative changes, invitation attribution and denied access/write operations. Its temporary fixtures and audit events roll back; no invitations are emailed. Unit/component checks cover rendering, scoped pagination, escaped wildcard input, filter preservation and trusted invitation actor selection. Supabase's security advisor returned no findings after the migration.
