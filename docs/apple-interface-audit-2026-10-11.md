# FixxFlow interface audit — 11 October 2026

## Verdict

The app has a coherent visual foundation, but its workflow and recovery behavior do not yet consistently meet the quality bar in `DESIGN_SYSTEM.md`. Prioritize protecting unfinished work and reliable recovery, then improve queue continuity and navigation. A wholesale visual redesign is not justified by the evidence gathered here.

This is an Apple-principles review of an original web application. Apple’s guidance on [design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles), [layout](https://developer.apple.com/design/human-interface-guidelines/layout), [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), and [feedback](https://developer.apple.com/design/human-interface-guidelines/feedback) informs the review. The repository design system governs implementation details and web behavior.

## Evidence and limits

- Live Safari inspection: authenticated administrator overview and populated All tickets queue, including screenshots and accessibility trees. The queue contained one closed pilot ticket. Empty/low-volume data cannot establish performance or scanning quality under real workload.
- Source review: shared shell, navigation, tokens, forms, ticket creation/list/detail/conversation/history, chat room, knowledge editor, reports, assets list, inventory list, People, administration hub, account/support/security, signup, and platform navigation/dashboard/error handling. This is representative cross-app coverage, not execution of every route and mutation.
- Current checks: **818/818 tests pass**, `npm run typecheck` passes, `npm run lint` passes. These checks do not certify visual usability or WCAG conformance.
- No production mutations, messages, permission changes, or redesigns were performed for this audit.
- Mobile/tablet rendering, 200% zoom, dark-mode rendering, forced colors, VoiceOver, slow/offline recovery, multi-user realtime behavior, employee sessions, and platform-owner sessions were **not newly verified live**. Existing CSS, tests, and the earlier checks summarized below provide supporting implementation evidence only. A local fixture server was available, but the independent in-app browser was unavailable; no fixture visual pass is claimed.

### Earlier responsive reviews (September 2026)

The earlier design reports are consolidated here. Synthetic fixtures covered 49
page/role combinations; representative Safari layouts covered 320–1920px and a
400px-high desktop viewport. An authenticated administrator session covered
mostly empty states, mobile navigation focus containment/restoration, and audit
log reflow at 200% zoom. Later compact-screen checks covered employee home,
administration, and chat creation. These were limited checks, not verification of
every role or populated workflow. Screen-reader use, OS reduced-motion/forced-color
settings, realtime recovery, and failing submissions remained unverified. Shared
tokens, native controls, navigation, and responsive primitives were reused with no
deliberate design-system exception. Current implementation requirements live in
`DESIGN_SYSTEM.md`; the October follow-up below records subsequent verification.

## Prioritized findings

P1 means risk of losing meaningful work. P2 means a material workflow, recovery, or accessibility gap. P3 means consistency or visual refinement. Source-confirmed findings were not deliberately reproduced by causing production failures.

### 1. P1 — Unfinished work has inconsistent navigation protection

**Evidence:** `src/features/tickets/ticket-draft-cancel.tsx:9` confirms only the explicit Cancel action, and checks only title/description. `src/features/tickets/message-composer.tsx:18` and `src/features/chat/chat-room.tsx:27` hold drafts in component state without navigation protection. `src/features/tickets/ticket-details-form.tsx:18` preserves edits through refreshes but has no general dirty-navigation guard. The knowledge editor protects unload and its Cancel button, but not ordinary Next.js navigation (`src/features/knowledge/article-editor.tsx:23`).

**Impact:** Following sidebar links or leaving a conversation can discard substantial written work without the warning required by design-system §5.4. Reload protection and explicit Cancel protection are different paths; both need coverage. Public and internal drafts are already separate in both ticket and chat composers and should stay that way.

**Recommendation:** Reuse a shared dirty-state policy across these surfaces. Warn only when meaningful changes would actually be lost; do not interrupt successful saves, harmless hash navigation, or links opened in another tab. Keep drafts in memory under the current product policy.

**Acceptance:** Enter distinct public/internal drafts, cancel navigation and confirm both remain; confirm discard and navigate successfully; cover sidebar navigation, browser Back, reload/close where supported, pending submission, successful save, and unchanged forms. Include unsaved ticket classifications and assignments, not just text fields.

### 2. P2 — Organization creation errors discard the correction context

**Evidence:** Department/location creation uses direct server forms (`src/app/app/organization/page.tsx:22`). Validation and database failures redirect to a page-level error (`src/app/app/organization/actions.ts:44–74`), without returning submitted values. Existing item editing already uses recoverable action results.

**Impact:** A duplicate name or invalid timezone can make users re-enter several fields. The page-level error is not connected to the affected field and is not programmatically focused. This conflicts with §5.4’s preservation and validation requirements.

**Recommendation:** Use the existing `ActionForm` and `SubmitButton` behavior for creation, return recoverable results, and add field-level errors where a specific input is at fault.

**Acceptance:** Duplicate department, invalid timezone/country code, and temporary save failure preserve every entry, focus the error summary, describe invalid inputs, and allow a corrected retry without duplicate creation.

### 3. P2 — Inventory error recovery does not fetch fresh data

**Evidence:** `src/app/app/inventory/error.tsx:2` wires “Try again” to `reset`. This installed Next.js version distinguishes `reset` (clear boundary state) from `retry` (refresh and reset): `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`, and `node_modules/next/dist/client/components/error-boundary.js:39–46`. Other application boundaries already use `retry`.

**Impact:** After a transient server-render/data failure, the button can re-render the same failed payload without a new fetch. It is not an absent callback; it is the wrong recovery operation for the promised behavior.

**Recommendation:** Align inventory with the existing `retry` boundaries.

**Acceptance:** In a local failure fixture, fail the first server fetch, recover the dependency, activate Try again, and verify a fresh request replaces the fallback with inventory.

### 4. P2 — Ticket detail loses the queue’s explicit return context

**Evidence:** Queue links contain only the ticket ID (`src/app/app/tickets/page.tsx:114`); the detail’s Back to tickets control links to bare `/app/tickets` (`src/app/app/tickets/[ticketId]/page.tsx:47`). A contextual desktop detail drawer is also absent, despite §4.1/§5.3 requiring one for rapid inspection.

**Impact:** Using the visible Back action after opening a filtered/paginated queue resets the URL context. Browser Back may behave better, but the product’s own return action should be dependable. A full route for every inspection also increases context switching.

**Recommendation:** First preserve a validated internal return URL and list position. Then add the specified desktop contextual panel, retaining full routes for deep work and compact screens.

**Acceptance:** Open from a query with view/search/status/sort/page; close or return and retain those values and scroll position. Drawer opening/closing must move and restore focus predictably, support Escape/history, and leave normal anchor/new-tab behavior available.

### 5. P2 — Global search remains an unfulfilled design requirement

**Evidence:** The live shell exposes area navigation and local ticket search, but no global search control. The source contains local searches, with no global command-search implementation or Cmd/Ctrl+K handler. §4.3 explicitly requires both.

**Impact:** Users must choose the correct product area before finding a ticket, person, or destination. This becomes more costly as the app grows.

**Recommendation:** Add the specified visible global-search entry and keyboard shortcut, using existing search and identity primitives. Clearly identify result types and respect each viewer’s access.

**Acceptance:** Keyboard opening, named dialog, focus containment as appropriate, Escape/return focus, loading/no-results/error states, distinguishable result categories, and accessible selection. Do not present this as a broken existing feature; it is missing functionality against the agreed specification.

### 6. P2 — Employee navigation retains too many peer destinations

**Evidence:** `src/components/navigation/workspace-nav.tsx:22–33` plus Notifications produces nine employee destinations, or ten with inventory access: Home, tickets, chats, articles, equipment, Account, Security, Contact support, Notifications, and optional item requests.

**Impact:** The employee experience retains much of the staff shell’s decision burden. The design system calls for a deliberately simpler portal with shallow navigation. This is a structural recommendation, not a demonstrated inability to complete a task.

**Recommendation:** Make Home, requests/conversations, and Help the primary employee choices; place account/security/preferences together and offer equipment/inventory contextually while retaining discoverable direct access. Validate terminology with pilot users before combining tickets and chats.

**Acceptance:** Employee and inventory-authorized employee sessions can still reach every permitted function; compact navigation stays keyboard accessible; primary labels match the employee’s task language.

### 7. P2 — Signup progress communicates its active state visually only

**Evidence:** `src/app/(auth)/signup/page.tsx:8` renders numbered spans and `is-current` styling inside a generic div. There are no named steps, `aria-current="step"`, or textual “Step 1 of 3” status.

**Impact:** Assistive technology does not receive the same clear progress model as sighted users. Numbers alone also leave subsequent steps unexplained.

**Recommendation:** Use a semantic named step list with current/completed state, or a concise textual progress indicator that accurately reflects the actual signup flow.

**Acceptance:** VoiceOver announces current step and total; active/completed state remains understandable without color; all signup screens use the same model.

### 8. P3 — Standalone history/recovery actions still vary across features

**Evidence:** The history page’s Back to conversation is a plain link (`src/features/conversations/history-browser.tsx:95`), while ticket detail uses button treatments for history. Chat’s standalone history controls are also plain links (`src/features/chat/chat-room.tsx:142`). Ticket conversation/report failures tell users to refresh rather than offering an immediate retry (`src/features/tickets/conversation-timeline.tsx:17`, `src/features/reporting/components.tsx:5`).

**Impact:** Action discoverability and recovery differ unnecessarily between otherwise related screens. The later design-system guidance explicitly standardizes standalone actions on 44px button treatments.

**Recommendation:** Reuse shared button styling while keeping anchor semantics. Add local retry where possible, preserving any mounted drafts. Continue treating filenames, ticket identities, and prose links as content links.

**Acceptance:** History/back/retry controls have visible focus and sufficient targets, behave consistently at compact widths, and do not clear drafts or reload unrelated regions unnecessarily.

### 9. P3 — Queue chrome competes with the work itself

**Evidence:** In the live desktop queue, users encounter the page title/description, a second queue title/description/count, a view-selector row, search, filter disclosure, instructional status, selection strip, and table headings before the first ticket. The screenshot confirms a substantial vertical stack even with filters collapsed (`src/app/app/tickets/page.tsx:64–108`, `src/app/globals.css:1703–1729`).

**Impact:** The hierarchy is clear, but the repeated explanation and segmented controls make a working queue feel closer to a settings page. This is a visual/efficiency judgment, not a measured accessibility defect.

**Recommendation:** Consolidate the queue title/count/view controls; reduce repeated explanatory copy and spacing while retaining persistent search, visible filter state, and 44px action targets. Preserve readable multiline tickets and SLA meaning.

**Acceptance:** Compare populated queues at desktop, 1024px, 390px, 320px, and 200% zoom. Improve visible work density without clipping identities, reducing targets, relying on hover, or hiding essential status.

## Strengths to preserve

- Semantic color tokens, readable text roles, light/dark palettes, visible focus, reduced-motion and forced-colors rules already exist. This is source evidence, not a blanket contrast certification.
- Mobile navigation implements a named modal, inert background, explicit keyboard cycling, Escape, and focus return.
- `ActionForm` retains mounted fields on recoverable failures, focuses feedback, announces progress, and guards duplicate submissions.
- Ticket and chat composers distinguish public replies/internal notes and keep their drafts separate. Chat explicitly warns that attachments are shared with the employee.
- Ticket detail handles stale revisions without silently replacing the user’s editing revision.
- Status, priority, SLA, and inventory states have centralized presentation and written meanings; SLA conveys more than color.
- Queue search/filter/pagination parameters are represented in URLs. Applied filter chips have descriptive removal names.
- Assets/People/inventory use shared patterns for labels, tables, pagination, permission-aware actions, and empty states. Administration has sensible grouped destinations. Reports distinguish missing timing data from zero and provide workload context.
- New-message affordances avoid forcing readers to the bottom of a conversation. Reordering article blocks and automation actions has explicit buttons.

## Implementation order and release checks

1. Protect unfinished work; repair organization creation recovery and inventory retry.
2. Preserve queue return context; implement contextual detail and global search as scoped features.
3. Simplify employee navigation; fix progress semantics and standalone actions.
4. Refine queue hierarchy against populated data and the full device matrix.

Before declaring the audit findings resolved, run live checks with administrator, technician, employee, inventory-authorized employee, and platform owner fixtures. Cover light/dark, 320/390/768/1024/wide widths, 200% zoom, keyboard-only operation, VoiceOver, long content, empty/loading/error states, offline/reconnect, stale edits, and incoming messages while reading or typing. Verify representative text/control contrast in rendered context. Exercise retry and validation failures in disposable local fixtures rather than production.

No shared components or tokens were changed during this audit. No exceptions to `DESIGN_SYSTEM.md` were introduced. The outstanding live checks above remain explicit; passing source tests is not a substitute for them.

## Implementation follow-up — 12 October 2026

All nine findings now have scoped implementations in the working tree. The original findings above remain a record of the pre-change audit.

- Shared `useUnsavedChanges` protects ticket creation/classification, ticket and chat drafts, article edits, automation edits, and recoverable `ActionForm` edits. Same-document anchors and modified/new-tab clicks remain native. Successful saves release the applicable draft guard; failures retain it. Queue live search also checks before replacing a panel containing unsaved edits.
- Organization creation uses `ActionForm`, mounted inputs, field errors linked to invalid controls, focused persistent error summaries, duplicate-submit protection, and retry. Inventory uses the installed Next.js `retry` boundary operation.
- Staff queue links retain validated filter/page return context. Desktop inspection uses a URL-selected detail panel, preserves the mounted queue, restores trigger focus, and replaces history when switching tickets. Compact links use full routes; compact deep-linked panels isolate the background, lock scrolling, cycle focus, and support Escape. Detail loading, missing-ticket, and primary fetch failures stay in the panel.
- Global search uses existing permission-scoped search RPCs and the session client, bounded results, role-aware destinations, grouped result semantics, arrow/Enter selection, and a visible Cmd/Ctrl+K entry. The native dialog is portalled outside hidden mobile navigation. Escape explicitly closes the search field/dialog, and focus returns to the visible mobile navigation control when its original trigger is hidden. Errors preserve the query and offer retry.
- Employees have Home, My requests, and Help articles as primary destinations; Account & more retains secondary functions. Signup screens share named progress with textual step totals and `aria-current="step"`. Standalone history/retry controls reuse shared button classes. Queue controls/count share a header and redundant explanatory chrome is reduced.

### Verification

- **840/840 tests pass**. New behavior tests cover dirty classifications and assignment, restored original values, save failure/retry and focused feedback, duplicate submissions, successful redirects, Back restoration, native navigation exceptions, ticket switching/return context, declined queue searches, search keyboard selection, mobile portal placement, and Escape dismissal.
- Type checking, ESLint, production build, and whitespace checks pass. The production build includes the new `/app/search` route.
- Safari local fixture checks: separate public/internal ticket drafts survive cancelled panel close; organization validation preserves name/city/region/country/timezone and focuses the error summary; corrected retry succeeds and resets creation fields; 390px employee search stays visible after navigation closes; simulated search failure recovers through Retry without losing the query; Escape closes directly and returns focus to the visible mobile toggle; 320px dark employee navigation retains secondary destinations and omits unauthorized inventory access; 1024px technician queue has the consolidated hierarchy; 1440px desktop row inspection moves focus to the panel heading, switching tickets updates the selected URL, and Close returns to the queue with focus on the last triggering ticket. Accessibility-tree inspection confirms named controls, signup steps, and error feedback. Dark signup marker contrast and collapsed-sidebar search wrapping were corrected during visual QA.
- Fixture routes use synthetic data and mocked mutations. The queue fixture renders server HTML inside the interactive wrapper; it does not certify real Next.js navigation, hydrated bulk selection, authenticated database access, or realtime behavior. No production records or settings were changed.

### Release verification limits

The implementation and local checks above are complete. Full authenticated end-to-end checks across all five role variants, VoiceOver speech output, forced-colors rendering, a measured 200% zoom pass, and offline/reconnect/realtime contention remain release verification tasks. The earlier audit's full device/state matrix is not claimed as executed. Automated authorization/query tests and Safari accessibility trees do not replace these checks.

### Shared components and design alignment

Reused `ActionForm`, `SubmitButton`, `LookupSelect`, `LiveSearchForm`, navigation glyphs, ticket presentation mappings, and existing surface/control/focus/theme tokens. Added shared dirty-navigation protection, `RetryButton`, `SignupProgress`, `OrganizationCreateForm`, queue-context/detail components, and global search. No UI library, icon family, competing token system, or deliberate exception to `DESIGN_SYSTEM.md` was introduced.
