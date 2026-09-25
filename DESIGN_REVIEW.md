# Responsive UX review — September 2026

This pass preserves existing workflows, permissions, and the approved FixxFlow brand. It improves shared behavior rather than adding a new styling system.

## Changes

- One mobile breakpoint (below 768px), with the collapsed workspace sidebar from 768–1199px. Short desktop windows scroll the navigation independently of the account controls.
- The employee portal reuses the accessible navigation behavior, with employee labels, active-page indicators, and a compact menu instead of a horizontally crowded link strip.
- Mobile navigation has an explicit close control, focus containment, Escape handling, focus return, inert page content, scroll locking, and cleanup when switching to desktop.
- Functional blue and muted-text aliases meet normal-text contrast on white. Brand artwork is unchanged. Keyboard focus is a solid outline; buttons and selects have consistent usable heights.
- Reflowing form fields and long content replace page-level horizontal clipping. Tablet ticket details stack before conversation space becomes too narrow. Compact ticket cards prioritize their subject and allow SLA text its own row.
- Queue filters use native disclosure; bulk tools show the selection count and appear only after selection. Select-all remains visible outside the compact table header, and clearing selection returns focus to a row.
- Invitations have persistent visible labels. A shared pending submit button prevents duplicate submissions and communicates progress across existing server forms.
- SLA target tables fit their cards and sidebars. Ticket details have a direct jump link. The ticket page uses a single main landmark.
- Knowledge content has readable line height and spacing. Chat keeps the conversation before management tools on narrow screens, and its scrollable message log is keyboard focusable.
- Administration uses three columns on wide screens and progressively reduces columns; availability remains communicated with text.
- Shared loading, not-found, and retry screens offer recovery within the workspace. Retry uses the installed Next.js 16.3 API to refetch data.

## Verification approach

Source review covered authentication/onboarding, all three role shells and dashboards, tickets, chat, knowledge list/article/editor, notifications, people, organization, profile/security, and administration.

49 page-and-role combinations were rendered locally from the actual components with synthetic data. These fixtures include populated lists, long titles, diagnostic strings, messages, and filenames; they do not connect to production or submit forms. Static previews assess presentation, not authenticated behavior.

Safari Responsive Design Mode was used for representative layouts at 320, 390, 767, 768, 800, 1024, 1440, and 1920px, including a 400px-high desktop viewport. Shared layouts and breakpoint edges were checked; this is not a claim to have tested every physical device or every possible content combination.

Automated regressions cover role-specific navigation, modal focus/cleanup, bulk selection and synchronization, pending controls, text contrast, and the existing product/security behavior. The global reduced-motion rule is retained; active-button movement is removed for reduced-motion users.

The existing tokens and primitives were reused. The contrast aliases in DESIGN_SYSTEM.md were updated to record the accessibility correction. No new UI library or competing design tokens were introduced.

## Task discoverability follow-up

- Home now offers “Start a chat” and “Open a ticket” for every role. Employee labels use “My chats” and “Help articles”.
- `/app/chat?start=1` opens the existing support-chat form for every role; the list has a visible creation action. Errors return to the form. Copy explains that the conversation is for the signed-in user and that a technician may not respond immediately. No new chat or permission model was introduced.
- Administration groups organization/departments/locations and people/technicians. Priorities and SLAs share one entry because their existing detail screens show the same policy. Planned assets move into a “Coming later” disclosure.
- Added role-by-role chat entry/form/error coverage and grouped-navigation assertions. Safari visual checks covered the changed administration, employee home, and chat creation at 320px, alongside the earlier responsive review.
- Mobile menu Tab traversal now explicitly includes links for Safari configurations that omit them from the native Tab order.
