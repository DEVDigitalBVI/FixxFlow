# App design review — September 25, 2026

Scope: shared authentication, agent/admin and platform shells; employee portal; ticket queue and detail; chat; knowledge; assets; people; administration; reports; audit; notifications; account/security.

Reference: DESIGN_SYSTEM.md, Apple HIG [layout](https://developer.apple.com/design/human-interface-guidelines/layout), [accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), and [motion](https://developer.apple.com/design/human-interface-guidelines/motion). Apply their clarity, consistency, feedback, adaptability and accessibility principles to this web app. This is not a certification of HIG or WCAG compliance.

## Implemented across shared surfaces

- A short brand-gradient rule adds a recognizable signature to page headers, sidebar identity and the employee home, using the existing palette.
- Dashboard metric surfaces have gentle tonal depth and clearer numeric rhythm. Action-card arrows receive a consistent outlined treatment and restrained pressed feedback.
- Inputs now have 3:1 boundaries against the light surfaces and solid offset focus rings. Avatar initials use a solid blue background with readable white text.
- Mobile sign-out controls recover their 44px target after a later stylesheet override. Desktop navigation no longer directs focus to the hidden mobile toggle.
- Keyboard-focused table rows gain a background cue; selected navigation remains visible in forced colors. Reduced motion disables new arrow movement.
- Existing buttons, cards, navigation, avatars, typography and semantic tokens are reused. New tokens are documented in the design system. No design-system exceptions or new libraries.

## Area review

| Area | Existing strengths retained | Follow-up / review limits |
| --- | --- | --- |
| Authentication/onboarding | Visible labels, autocomplete, pending sign-in/reset states, simple mobile layout | Onboarding progress uses styled spans; add explicit current-step semantics. Check full error focus and draft retention across submissions. |
| Workspace/platform navigation | Active edge marker, icon labels, tablet rail, scrollable navigation, mobile focus trap | Global command search specified in section 4.3 is absent. Requires a separate interaction implementation. |
| Employee portal | Larger typography, simple task cards, recent requests, no operational metrics | Navigation still has nine destinations including account/notifications. Group secondary account destinations in a future navigation redesign. |
| Ticket queue/detail | List-first, URL filters, bulk selection feedback, mobile stacked rows, text status/priority cues | Contextual desktop detail drawer is absent; full routes are used. Adding a drawer needs URL/selection/focus behavior and workflow testing. |
| Chat/conversations | Labeled private notes, live announcements, explicit multiline behavior, drafts and new-message affordance | Verify realtime reconnect, sending failures and screen-reader announcements with authenticated test participants. |
| Knowledge/assets | Shared forms and panels, readable article typography, labeled inputs and semantic content | Verify long articles, files, empty inventory and edit failures with representative data. |
| Reports/analytics/audit | Text summaries, data tables, dashed chart series, labeled filters | Verify long labels and dense data at mobile widths and 200% zoom. |
| People/administration/account | Shared settings cards, responsive tables, role labels, pending actions | Form error summaries and draft preservation are not uniform; review each mutation workflow before release. |
| Notifications | Explicit read/unread text, recovery link, pagination | Check live updates and keyboard operation with populated and empty inboxes. |

## Verification

- Automated suite: 81 tests passed, including new desktop navigation focus and control/focus contrast coverage, existing mobile focus trapping/restoration, role navigation, submission feedback and domain checks.
- ESLint, TypeScript and the production build passed.
- Responsive and reduced-motion rules reviewed in source. Authenticated Safari checks are detailed below; source/tests are not a substitute for full browser accessibility verification. The initial preview sign-in issue was resolved by restoring missing public Supabase configuration in ignored `.env.local`.


## Authenticated browser follow-up

Inspected the administrator session in Safari: overview metrics, empty ticket queue, new-ticket form, administration hub, and the assets empty-state accessibility tree. The overview and queue screenshots show consistent header hierarchy, aligned metrics and readable navigation. No tickets exist in this workspace, so populated queues and ticket details could not be checked with current data.

The new-ticket form exposed uneven field alignment when one column contains help text. Shared `.field` now aligns its content to the start, and placeholders explicitly use the tested muted-text token rather than the browser's faint default. The administration Assets section touched the preceding cards; it now reuses `administration-group` spacing. Title-to-description keyboard navigation was exercised without submitting a ticket or changing data.

The continued Safari review verified the following:

| Surface / behavior | Browser evidence |
| --- | --- |
| Knowledge list and published article | List at 390px; article at 320px. Text and actions reflowed without visible horizontal clipping. |
| People | Tablet and 390px layouts, invitation form and populated member card. Fixed a broad descendant selector that overrode avatar alignment and text color; verified centered white initials afterward. |
| Reports | Desktop and 390px empty-data layouts. Metrics remained readable in two columns on mobile. |
| Navigation | 1024px icon rail retained accessible names. Mobile menu moved focus to Close, Shift+Tab wrapped to the last link, and Escape restored focus to Open navigation. Background content was absent from the accessibility tree while open. |
| Profile and organization | Desktop screenshots verified labeled forms, card layout and readable fields. No forms were submitted. |
| Chat, notifications, security and assets | Accessibility-tree review of empty states, chat creation form, notification filters and security setup entry point. No conversations, notification updates or security changes were made. |
| Audit log | Empty state and filters reviewed; screenshot at Safari-confirmed 200% zoom showed readable content and wrapped filter actions without visible horizontal clipping. Zoom restored to 100%. |

Remaining release checks: employee and platform-owner sessions; populated ticket queues/details, conversations, notifications and dense report data; actual screen-reader workflows; realtime/reconnect and submission failures. Reduced-motion and forced-color support were checked in source, not with those OS settings enabled. This review does not claim every role, route and interaction is browser-verified.
