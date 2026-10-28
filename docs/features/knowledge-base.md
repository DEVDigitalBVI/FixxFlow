# Knowledge base

Categories: Accounts, Email, Network, Hardware, Software, Security. Organizations start with no organization-owned articles and can browse the shared FixxFlow library. The sample-guide cleanup migration removes untouched original guides and disables automatic article seeding; authored or edited guides and guides with attachments or incoming article links are preserved.

IT technicians and administrators create/edit articles. Draft and archived articles are staff-only; published employee-facing articles are readable by active organization members; IT-only articles stay private to staff. Article IDs provide stable links. Editors use optimistic revision checks so a stale editor cannot overwrite newer work. Editing a published article updates it on save; set visibility to Draft before developing changes that should remain private. Separate published/draft revisions are deferred.

The structured editor supports headings, paragraphs, bold/italic, lists, quotes, code, HTTP(S) links, and image blocks with required alt text. Preview uses React text nodes; raw HTML is never executed. Images must reference uploads associated with the article. This intentionally avoids adding an editor library. Keyboard-accessible buttons move/remove blocks; no drag operation is required.

Private attachments support JPG/PNG/WebP, PDF, plain text, DOCX, and XLSX up to 6 MB. Create an article before uploading files. Downloads and inline images are served through a session-authenticated route with article RLS, private/no-store caching, and nosniff headers. Non-image attachments download rather than execute inline. Existing file URLs stop working when article access is withdrawn. Direct signed storage URLs are not exposed by this feature. Uploaded file contents are not malware-scanned; attachments are authored by authorized IT staff.

Related articles are limited to eight, within the same organization. Readers only see permitted targets. The initial selector shows the first 200 titles and retains existing selections beyond that range; searchable selection is a future improvement.

Published article views are recorded on client mount and deduplicated per signed-in user/article/UTC day. Each user has one changeable helpful/not-helpful vote. Database defaults own identity and timestamps; clients cannot forge them. Staff can see total daily-reader views and current vote counts in Article insights. Draft views are not recorded. These are aggregate product signals, not AI inference or training. History of individual vote changes and anonymous readership are not collected.

Search uses the shared literal substring matching contract across title, summary, and block text. Browsing is category-filtered with 24 articles per page. Ticket search links now query published knowledge articles rather than static data.

Ticket intake suggests up to three guides by matching title, description, and
category against up to 200 recently updated published article summaries from the
same organization and the shared FixxFlow library. Matching runs in the browser; guides open in a separate tab to
preserve the draft. Missing or unavailable suggestions never prevent submission,
and Browse all guides remains available.

Checks: `npm test`, lint, typecheck, build; `supabase/tests/knowledge-regression.sql` verifies authoring, draft/storage confidentiality, publication, revision conflicts, analytics deduplication, membership isolation, and MFA. All SQL fixtures roll back. No test email delivery is required.

## Curated general IT collection

`content/knowledge/general-it.json` contains 70 guides: the existing 30 employee/general IT guides plus 40 FixxFlow feature how-tos. The original 14 cover FixxFlow requests, password resets, authenticators, connectivity, email, printers, displays, browsers, software access, phishing, and lost devices; they were reviewed against the FixxFlow implementation on September 25, 2026. Sixteen additional guides were reviewed against official vendor documentation on October 6, 2026, with an individual `reviewedOn` date. They cover Teams joining/chat, audio, cameras, screen sharing, Office saving/recovery, Word PDF export, Excel formulas, Outlook invitations, OneDrive sync, cloud-file recovery, secure sharing, Windows performance, approved updates, mouse/keyboard issues, and support scams. A directory links searchable official help libraries and service-status pages, explaining the limits of public status information for business accounts.

Relevant guides link to official Microsoft, Google, Apple, or NIST documentation. These are original practical summaries with source links, not copies of third-party articles or automated feeds. The collection-level `reviewedOn` retains the original review date; `updatedOn` records the expansion. Google Workspace Learning Center and Microsoft Support informed the topic-based organization; their text, branding, and layout were not copied.

Each article defines its scope, practical steps, a result check, and when to contact IT. Company-specific network names, support hours, approvals, recovery guarantees, and software vendors are deliberately not assumed. Keep those details in locally maintained articles when confirmed. Staff can edit or archive every imported article using the normal editor.

### FixxFlow feature how-tos

The 40 feature guides were checked against repository implementation on October
12, 2026. Search for **FixxFlow: get started and find the right feature**, then
follow Related articles, or search **FixxFlow** plus the task name. Coverage includes
account/security, navigation/search, notifications, ticket creation/history/work,
chat, equipment/imports, department inventory and fulfillment, knowledge authoring,
reports/exports, administration/access/routing/audit, automation creation/testing/
time thresholds/operations/portability, and the separate owner console.

Every guide names its audience and retains `sourcePaths` for future maintenance.
Published guides are readable by organization members; administrator/owner
instructions contain no private records or credentials and do not grant access.
The existing category, rendering, heading navigation, and related-article components
are reused; no UI or permission model changed. The original 30 source articles are
unchanged, and the additive importer preserves existing workspace edits.

Published to the Peter Island Resort and Spa workspace on October 12, 2026: 40
guides added, all 30 existing articles preserved exactly, and 70 total articles.
Post-import checks confirmed all 40 new bodies and related-link lists match the
reviewed collection. A repeat import in a rolled-back transaction created zero
articles. No schema, roles, permissions, or email configuration changed.

Legacy organization copies can still be explicitly imported per organization. The shared library now provides the same collection without per-organization imports. Generate a reviewable SQL transaction with:

```sh
node scripts/knowledge-import.mjs ORGANIZATION_UUID ORGANIZATION_SLUG > /tmp/knowledge-import.sql
```

Review the SQL and run it through the authorized database connection for that organization. The script itself has no database credentials and performs no network requests. It checks the organization identity, uses stable organization-specific article IDs, reuses matching titles, publishes new articles, and links related guides. Existing articles (including renamed or edited imported guides) are never overwritten. Imported articles have no attributed human author; database audit events record system creation. Re-running is additive, so use the editor for subsequent content changes. The collection was imported into the existing Peter Island Resort and Spa workspace; future customer workspaces have no organization-owned articles but can read the shared library.

The UI reuses portal cards, existing surface/border/focus tokens, and native links. Topics wrap from three columns to two to one on compact screens. Article section links target focusable headings; all support actions remain visible without hover, and no animation is introduced. Existing search, pagination, tenant isolation, staff editing, feedback, and related articles remain in use.

Validation: collection parsing and related-link tests; heading-link accessibility tests; TypeScript, lint, build; transaction-based database rehearsal proving repeat imports create no duplicates and preserve a renamed, edited guide.

## Article audiences

Audience is separate from publication status: **Employee-facing** and **IT only**. New articles default to IT only. Employees can read only published Employee-facing articles, including through global search, ticket suggestions, related links and attachment downloads. IT staff can read both audiences and have a labeled Audience filter. Drafts and archived articles are always private to IT. The editor requires an explicit audience value when saving; the default keeps unreviewed imports private.

The initial content review covers all 70 hosted articles: 42 employee-facing guides and 28 IT-only operational procedures. The per-article decision and reviewed content fingerprint are in `docs/knowledge-audience-review.json`. The migration only exposes reviewed employee content when its fingerprint still matches; changed or unknown articles remain IT only. Publishing guidance and the employee reopening label were corrected during the review.

## Shared FixxFlow library

The knowledge base combines organization-owned articles with `library_articles` through the security-invoker `readable_knowledge_articles` view. A library article has no organization, and organizations cannot edit its shared source. Administrators can hide or restore a guide in their own workspace without changing other organizations. Existing imported organization copies remain unchanged to preserve customer edits. The library starts with the 70 reviewed guides from `content/knowledge/general-it.json`, including their related-article links. Its stable IDs use the import helper's all-zero namespace; they are independent of tenant article IDs.

Active members can read published library articles. Employees see only the `employees` audience; technicians and administrators can also read `it_only` articles. Inactive and unassigned accounts, anonymous requests, and members with unmet MFA requirements cannot read the library. Only a platform owner with a valid session and completed MFA can create or update it. Drafts and archived library articles are visible only to that owner, including in search. Owner edits retain optimistic revision checks and produce platform audit entries without copying article bodies into the audit log.

Owners use **Platform → FixxFlow library** to search, create, revise, publish, and archive guides. Library articles reuse the structured article editor, audience controls, preview, and unsaved-change protection. This first version supports text blocks and HTTP(S) links; uploads and image blocks remain organization-specific. Related library articles can link to one another, and reader RLS filters related links by audience and publication status. Organization article related selections remain within their organization.

Shared guides appear alongside organization articles in knowledge browsing, category/audience filters, paginated search, global search, and new-ticket suggestions. They are labeled **FixxFlow library** and use the existing article detail URLs. Shared readers have helpful voting and daily view tracking. Workspace staff see only their organization’s usage; verified platform owners see aggregate totals on the shared article’s edit page.

The `membership_and_shared_library` migration also enforces one organization membership per user, including inactive memberships. It stops on duplicates without deleting or selecting memberships. Before deployment, check for duplicates:

```sql
select user_id, count(*)
from public.organization_memberships
group by user_id
having count(*) > 1;
```

`npm test` includes the permanent catalog-driven organization isolation sweep, so the existing Checks workflow runs it on pull requests and main pushes. It discovers every public organization-owned table, checks enabled RLS, inserts a foreign canary into each table, and verifies foreign reads/inserts/updates/deletes and anonymous reads. Only fixture checks and triggers are bypassed in that disposable PGlite database; migrated RLS and grants are unchanged. This is an authorization regression test, not a replacement for the domain constraint/trigger suites or live Storage and Realtime service tests. Library tests separately cover shared audiences, lifecycle, active membership, owner/session/MFA requirements, revisions, audit records, and cross-workspace updates.

## Request suggestions and related selections

As a request subject is typed, up to three ranked, permitted published guides appear
beneath it. Queries include only the subject and optional category, not the request
description. Suggestions search the full readable collection, including older
articles and visible library guides. Word ranking and Wi-Fi normalization are
handled in PostgreSQL, with indexed candidate filtering. Superseded requests are
cancelled and ignored; guides open in a separate tab to preserve the request draft.

No matching guide shows “No related guides found. Continue with your request.” A
loading error instead offers Retry and states that the request can still be
submitted. The form never depends on suggestion availability.

Related-article selection searches titles across the entire allowed collection and
pages 24 choices at a time. Up to eight selections stay visible and submitted
across searches, pages and failures. Workspace editors choose their organization’s
articles; platform owners choose library articles. Enter in the search field does
not save or publish the article.

## Library usage and workspace visibility

Library views count each member once per UTC day. Helpful votes retain the latest
choice per member and article. Identity and recording time are database-owned;
inactive accounts, hidden guides, drafts, unmet MFA and inappropriate audiences
cannot record usage. Workspace staff see only their organization’s counts. The
platform owner’s aggregate totals contain no reader identities or organization
names.

Administrators use **Settings → Knowledge base → FixxFlow library**, or **Manage
library guides** from the knowledge base, to hide and restore published guides.
Hidden guides remain listed in that administrator-only page. Database policies
exclude them from normal browsing, search, subject suggestions, related links and
direct reading in that workspace, including for staff. Platform maintenance and
other workspaces remain unaffected. Actual visibility changes are audited;
repeated requests are idempotent.

Apply `20261027173607_knowledge_library_enhancements.sql` before deploying these
changes, after the pending chat migrations. This adds workspace preferences, scoped
view/vote tables, aggregate usage and ranked suggestions; it does not alter existing
workspace article feedback or imported copies.
