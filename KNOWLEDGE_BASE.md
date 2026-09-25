# Knowledge base

Categories: Accounts, Email, Network, Hardware, Software, Security. The four original guides are migrated into each existing organization and seeded for new organizations.

IT technicians and administrators create/edit articles. Draft and archived articles are staff-only; published articles are readable by active organization members. Article IDs provide stable links. Editors use optimistic revision checks so a stale editor cannot overwrite newer work. Editing a published article updates it on save; set visibility to Draft before developing changes that should remain private. Separate published/draft revisions are deferred.

The structured editor supports headings, paragraphs, bold/italic, lists, quotes, code, HTTP(S) links, and image blocks with required alt text. Preview uses React text nodes; raw HTML is never executed. Images must reference uploads associated with the article. This intentionally avoids adding an editor library. Keyboard-accessible buttons move/remove blocks; no drag operation is required.

Private attachments support JPG/PNG/WebP, PDF, plain text, DOCX, and XLSX up to 6 MB. Create an article before uploading files. Downloads and inline images are served through a session-authenticated route with article RLS, private/no-store caching, and nosniff headers. Non-image attachments download rather than execute inline. Existing file URLs stop working when article access is withdrawn. Direct signed storage URLs are not exposed by this feature. Uploaded file contents are not malware-scanned; attachments are authored by authorized IT staff.

Related articles are limited to eight, within the same organization. Readers only see permitted targets. The initial selector shows the first 200 titles and retains existing selections beyond that range; searchable selection is a future improvement.

Published article views are recorded on client mount and deduplicated per signed-in user/article/UTC day. Each user has one changeable helpful/not-helpful vote. Database defaults own identity and timestamps; clients cannot forge them. Staff can see total daily-reader views and current vote counts in Article insights. Draft views are not recorded. These are aggregate product signals, not AI inference or training. History of individual vote changes and anonymous readership are not collected.

Search uses Postgres full-text indexes across title, summary, and block text. Browsing is category-filtered with 24 articles per page. Ticket search links now query published knowledge articles rather than static data.

Checks: `npm test`, lint, typecheck, build; `supabase/tests/knowledge-regression.sql` verifies authoring, draft/storage confidentiality, publication, revision conflicts, analytics deduplication, membership isolation, and MFA. All SQL fixtures roll back. No test email delivery is required.
