# FixxFlow Product Design System

Status: Initial source of truth  
Applies to: Admin/agent workspace, employee support portal, and shared product UI  
Primary implementation target: React and Next.js

## 1. Purpose and authority

This document is the product UI source of truth. Use it when designing, implementing, or reviewing every user-facing feature. If a mockup or one-off implementation conflicts with this document, follow this document unless the product owner explicitly approves a change.

FixxFlow should feel like an original, modern IT support SaaS platform: calm, fast, legible, trustworthy, and visibly in motion. It may draw general inspiration from the three reference screenshots discussed during product planning, but it must not copy any single product's layout, visual identity, components, iconography, or distinctive interaction patterns.

## 2. Product experience principles

1. **Clear hierarchy before decoration.** The page title, primary task, current state, and next action must be apparent at a glance.
2. **High density without enterprise clutter.** Show useful operational context compactly, but hide infrequent controls behind menus, drawers, or expandable sections.
3. **Progressive disclosure.** Start with the minimum needed to decide or act; reveal history, metadata, and advanced controls in context.
4. **Fast perceived response.** Acknowledge every action immediately with pressed, loading, optimistic, success, or error feedback.
5. **Consistent patterns.** The same action, state, and object must look and behave the same across dashboards, queues, tickets, and chat.
6. **Accessible by default.** Keyboard access, visible focus, readable contrast, semantic structure, and assistive technology support are acceptance criteria, not enhancements.
7. **Original web product, not simulated macOS.** Apply Apple Human Interface Guidelines principles—hierarchy, clarity, consistency, feedback, and direct manipulation—without imitating macOS chrome, materials, traffic-light controls, or platform-specific ornament.
8. **Color supports meaning; it never carries meaning alone.** Pair semantic color with text, shape, icon, or position.

## 3. Visual foundation

### 3.1 Color

Use CSS custom properties or theme tokens. Components must not contain unexplained hard-coded colors.

```css
:root {
  --color-brand-primary: #007aff;
  --color-brand-secondary: #00c6ff;
  --color-brand-navy: #0f172a;
  --color-brand-purple: #865cf6;
  --color-canvas: #f8fafc;
  --color-surface: #ffffff;
  --color-surface-subtle: #f9fafb;
  --color-surface-raised: #ffffff;
  --color-border: #e5e7eb;
  --color-border-strong: #d1d5db;
  --color-text: #0f172a;
  --color-text-muted: #64748b;
  --color-text-subtle: #64748b;
  --color-accent: #0066d6;
  --color-accent-hover: #0058b8;
  --color-accent-subtle: #eaf5ff;
  --color-success: #15803d;
  --color-success-brand: #22c55e;
  --color-success-subtle: #ecfdf3;
  --color-warning: #a15c00;
  --color-warning-brand: #f59e0b;
  --color-warning-subtle: #fff7e6;
  --color-danger: #c92a2a;
  --color-danger-brand: #ef4444;
  --color-danger-subtle: #fff1f1;
  --color-info: #0066d6;
  --color-info-subtle: #eaf5ff;
  --color-focus: #007aff;
  --shadow-card: 0 1px 2px rgb(16 24 40 / 5%), 0 4px 12px rgb(16 24 40 / 4%);
  --shadow-overlay: 0 16px 40px rgb(16 24 40 / 18%);
}
```

Functional links and primary buttons use the darker `--color-accent` alias to meet normal-text contrast. The logo and brand artwork retain the primary brand blue. Focus indicators use a solid outline rather than a translucent tint.

The core brand-board palette is `#007AFF` primary blue, `#00C6FF` secondary cyan, `#0F172A` navy, `#64748B` slate, `#E2E8F0` border, `#F8FAFC` background, `#22C55E` success, `#F59E0B` warning, `#EF4444` critical, and `#865CF6` innovation/accent. The darker semantic aliases above are used where the raw brand colors would not meet text contrast. Validate normal text at WCAG AA contrast (4.5:1), large text and essential graphical objects at 3:1, and interactive state contrast in context. Use blue primarily for interactive emphasis. Reserve green, amber, and red for their meanings; purple is optional and should be rare.

### 3.2 Brand identity and logo flow

- The approved mark is a layered ribbon-style capital **F** with an integrated circular wrench. Its cyan-to-blue motion and deep navy folds express speed, continuity, and dependable technical support.
- The product name is always written **FixxFlow** with two lowercase x characters and capital F characters. The primary tagline is **IT SUPPORT IN MOTION**.
- Use the full primary or horizontal logo on authentication, onboarding, marketing, exported documents, and other brand-forward surfaces.
- Use the horizontal logo in the expanded application sidebar or wide header. Use the icon alone in the collapsed sidebar, favicon, app launcher, compact mobile header, and loading identity.
- On light surfaces, use the primary blue/navy artwork. On dark navy surfaces, use the dark-mode or reversed-white asset. Do not recolor, stretch, rotate, outline, separate, or rearrange the F and wrench.
- Keep clear space around the logo. At small sizes, drop the tagline before reducing legibility; use the icon rather than forcing the wordmark into a square.
- The logo gradient belongs to brand artwork and occasional brand-forward moments. Functional controls should normally use solid semantic token colors, not gradients.
- Prefer motion cues that echo the mark's forward sweep: short horizontal reveals, progress movement, and directional transitions. Keep them subtle, 120–200ms, and fully compatible with reduced-motion settings.
- Product copy should sound clear, capable, and active. Favor outcome language such as “Resolve ticket,” “Route request,” and “Keep work moving.” Avoid mechanical jargon in the employee portal.

The drop-in raster asset package lives under `public/brand/fixxflow/`. Treat its PNG masters as approved artwork; do not recreate the wordmark with live text. A designer-authored vector master should replace raster artwork if large-format print production is required.

### 3.3 Typography

- Use a highly legible system-oriented sans-serif stack: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Default body: 14px/20px in the agent workspace; 16px/24px in the employee portal and prose-heavy content.
- Page title: 24–28px, 600–700 weight, tight but readable line height.
- Section title: 16–18px, 600 weight.
- Card/table label: 12–13px, 500–600 weight. Do not use tiny uppercase text for long labels.
- Data values: use tabular numerals when alignment matters.
- Keep line length near 45–75 characters for prose. Do not communicate hierarchy through font size alone; combine size, weight, spacing, and placement.

### 3.4 Spacing, shape, and elevation

- Base spacing unit: 4px. Preferred steps: 4, 8, 12, 16, 20, 24, 32, 40, 48.
- Dense rows: 40–44px minimum height. Standard controls: 40px. Prominent portal controls: 44–48px.
- Default page padding: 24px desktop, 20px tablet, 16px mobile.
- Card padding: 16–24px; do not nest multiple bordered cards without a clear hierarchy.
- Radius: 8px controls, 10–12px cards, 14–16px major panels. Pills are reserved for compact status, filters, and avatars.
- Use borders and surface shifts before shadows. Shadows should indicate elevation, not decorate every object.
- Icons should be from one consistent outline icon family. Default size 16–20px. Every unfamiliar icon-only action requires an accessible name and tooltip.

### 3.5 Motion

- Use motion to explain change, not to entertain. Most transitions: 120–200ms with an ease-out curve.
- Avoid large parallax, bouncing, or decorative looping animation.
- Honor `prefers-reduced-motion: reduce`; eliminate nonessential animation and use immediate state changes or fades.
- Never delay a task to complete an animation.

## 4. Application shell and navigation

### 4.1 Agent/admin workspace

- Use persistent left navigation on desktop. Target width: 232–264px expanded and 64–72px collapsed.
- Navigation groups should reflect stable product areas, not every available page. Provide icon, label, active state, and optional count. The active state must include more than color.
- Keep account/workspace controls separate from primary navigation.
- The main content area should have a clear page header containing title, concise context, primary action, and only the most relevant secondary controls.
- Use a contextual right-side detail drawer for rapid inspection and editing without losing queue context. Provide an optional full detail view for long work, deep linking, complex history, or narrow screens.
- Preserve the user's list position, filters, and selection when opening and closing a drawer.

### 4.2 Responsive behavior

- Design mobile-first behavior intentionally; do not merely squeeze the desktop shell.
- Suggested breakpoints: compact below 768px, medium 768–1199px, wide at 1200px and above. Use content-driven adjustments when a component fails earlier.
- On medium screens, collapse the left navigation by default and reduce nonessential table columns.
- On compact screens, navigation becomes an overlay sheet; the detail drawer becomes a full-screen route or modal sheet with browser history support.
- Never create horizontal page scrolling. Data tables may scroll within a labeled region, but also provide a stacked/card representation when completing core tasks on mobile.
- Primary actions remain reachable without covering content. Do not place critical actions only on hover.

### 4.3 Command search

- Provide keyboard-accessible global command search, opened by a visible control and `Cmd/Ctrl+K`.
- Use a semantic dialog with a labeled search input, grouped results, arrow-key navigation, Enter to select, and Escape to close.
- Include recent destinations and actions only when helpful. Clearly distinguish navigation, tickets, people, and commands.
- Announce result counts and selection changes appropriately without excessive screen-reader chatter.

## 5. Core layouts and components

### 5.1 Dashboard

- Use compact dashboard cards that answer a specific operational question. Each card needs a title, current value or concise content, time/context label, and an obvious drill-down where applicable.
- Prefer a small number of meaningful metrics over decorative charts. Charts require accessible summaries and must not rely on color alone.
- Align comparable values and keep card heights consistent within a row. Empty cards explain why no data exists and what the user can do next.

### 5.2 Ticket queue: list first, board later

- The list/table view is the primary V1 queue. Optimize scanning, filtering, sorting, keyboard movement, and opening details without losing context.
- Recommended default columns: ticket identifier, subject/requester, status, priority, assignee/team, updated age, and SLA state. Hide lower-value columns responsively or through user configuration.
- Make the subject the primary visual anchor. Keep metadata quiet but readable.
- Use sticky headers for long queues. Bulk selection requires a visible selection count and an explicit bulk-action bar.
- Sorting must expose direction in text/ARIA state. Filters must be removable individually, clearable together, URL-shareable where feasible, and retained through detail navigation.
- Use cursor or server pagination/virtualization for large datasets; do not render an unbounded ticket history.
- A later board view may reuse the same query, filter, ticket-card, and status primitives. It must be an alternative view, not a separate data model. Provide keyboard-accessible movement and a non-drag alternative.

### 5.3 Detail drawer and full ticket view

- Default desktop drawer width: 420–560px, capped so the underlying queue remains recognizable. Complex tickets may open in a wider panel or full page.
- The drawer needs a labeled heading, stable close control, focus management, and a clear path to the full view.
- Organize content in this order: identity and state, next actions, requester/context, conversation, structured details, activity/history.
- Keep status, priority, and assignment actions near the ticket heading. Destructive actions live in an overflow menu and require confirmation when not easily reversible.
- Opening the drawer moves focus to its heading or first meaningful control; closing returns focus to the triggering row. Trap focus only when the drawer is modal.
- Deep-link ticket selection in the URL when practical so refresh and sharing retain context.

### 5.4 Forms

- Every control has a persistent visible label; placeholder text is an example or hint, never the only label.
- Group related fields with headings or `fieldset`/`legend`. Mark required fields consistently and explain the convention.
- Validate on blur or submit unless earlier feedback prevents costly work. Do not show errors before the user has interacted.
- Put error text next to the affected field, connect it with `aria-describedby`, and provide a focusable error summary for failed multi-field submissions.
- Preserve entered values after validation or server errors. Disable submission only while a duplicate request is genuinely possible, and show progress in the control.
- Use native input semantics and browser autocomplete where appropriate. Provide safe cancel behavior and warn before discarding substantial unsaved changes.

### 5.5 Buttons, menus, and actions

- One primary action per surface or clearly bounded region. Secondary actions use quieter styling; tertiary actions are text or menu items.
- Button labels describe outcomes: “Assign ticket,” not “Submit.”
- Icon-only controls must have at least a 40×40px interactive area even if the glyph is smaller.
- Menus contain short, related actions and support arrow keys, Enter/Space, Escape, and focus return.
- Use confirmation dialogs only for destructive, costly, or irreversible actions. The confirmation names the object and consequence; the destructive button uses a specific verb.

### 5.6 Dialogs and notifications

- Use a dialog for a focused decision or short task, not as a substitute for page structure.
- Dialogs must have an accessible name, initial focus, contained tab order, Escape behavior unless unsafe, and focus restoration.
- Use inline feedback for field or local errors, banners for page-level conditions, and toasts for brief confirmation of completed actions.
- Toasts must not be the sole location of essential information and must remain long enough to read. Errors that require action should persist.

### 5.7 States

Every component and feature must explicitly design and test:

- default, hover, active/pressed, focus-visible, selected, and disabled;
- loading, empty, error, success, stale/offline where relevant;
- long text, missing optional data, restricted permission, and partial data;
- narrow viewport, zoom to 200%, keyboard-only operation, and reduced motion.

Use skeletons only when the approximate structure is known and the wait is noticeable. For short actions, show progress on the initiating control. Empty states explain the state and offer one relevant next action. Disabled controls should be rare; when the reason is not evident, explain it.

## 6. Ticket semantics

### 6.1 Status

Use a shared `TicketStatus` model and one presentation mapping everywhere. Recommended initial statuses:

| Status | Label treatment | Additional cue |
|---|---|---|
| New | neutral/info subtle badge | inbox/new icon or “New” text |
| Open | accent subtle badge | open-circle icon |
| Pending | warning subtle badge | pause/clock icon |
| Resolved | success subtle badge | check icon |
| Closed | neutral muted badge | lock/check icon |

Status badges use text plus color and may include an icon. Do not invent a new color per workflow state. State transitions must provide immediate feedback and surface failures with recovery.

### 6.2 Priority

Recommended initial priorities: Low, Normal, High, Urgent. Always display the written label. A compact icon or bar count may supplement it, but color alone is forbidden. Reserve danger styling for Urgent or a breached critical condition; High should not visually overwhelm every queue.

### 6.3 SLA and time

- Express time in plain language in scanning contexts (“2h left,” “Breached 18m ago”) and expose the exact timestamp in a tooltip or detail view.
- Distinguish warning from breach using label and icon as well as color.
- Relative times must update at a sensible interval and have an accessible exact-time representation.

## 7. Chat and conversation UI

- Treat chat as a continuous support conversation tied to ticket context, not a decorative messaging clone.
- Clearly distinguish employee, agent, system event, and internal note using labels, alignment/surface treatment, and icons—not color alone.
- Keep message width readable. Show sender and timestamp at logical group boundaries rather than repeating noisy metadata on every bubble.
- Internal notes must be unmistakable before composition and after posting. The composer mode label and submit action must state “Internal note” when active.
- The composer supports keyboard entry, attachments, drafts, sending progress, retry after failure, and multiline content. `Enter` versus `Shift+Enter` behavior must be visible or configurable; never surprise users with an accidental send.
- New messages should not force-scroll a user who is reading history. Show a “new messages” affordance instead. Maintain focus and announce incoming messages politely.
- System events such as assignment or status changes should be compact timeline items, not chat bubbles.
- Sanitize rendered content, constrain attachments, and never render untrusted HTML directly.

## 8. Simplified employee support portal

The employee portal is intentionally simpler than the agent workspace.

- Lead with a prominent plain-language request/search entry point: “How can we help?”
- Keep navigation shallow: Home, My requests, Help/knowledge, and account controls are usually sufficient.
- Use larger type and targets, more whitespace, and fewer visible metadata fields than the agent workspace.
- Guide request creation with progressive disclosure and human language. Ask only for information needed to route or solve the issue.
- Show request status, latest response, and next expected step. Translate internal workflow terms into employee-friendly language where needed.
- Make adding a reply or attachment obvious. Hide assignment mechanics, internal notes, SLA machinery, and operational analytics.
- Provide confirmation and a durable request reference after submission; never leave success dependent on a transient toast.

## 9. React and Next.js implementation rules

### 9.1 Architecture and reuse

- Prefer server components for data-reading page structure and client components only where interactivity, browser state, or client APIs require them.
- Keep domain components separate from low-level UI primitives. Example layers:
  - primitives: `Button`, `Input`, `Badge`, `Dialog`, `Drawer`, `Menu`, `Tooltip`, `Table`;
  - domain: `TicketStatusBadge`, `PriorityIndicator`, `AssigneePicker`, `SlaIndicator`, `MessageComposer`;
  - feature: `TicketQueue`, `TicketDetailPanel`, `ConversationTimeline`.
- Define variants in the component rather than scattering class combinations through feature code. Centralize design tokens and semantic state mappings.
- Reuse behavior as well as appearance. Do not create separate drawer, badge, or status implementations for each page.
- Use typed domain models and exhaustive mappings so new statuses or priorities produce a compile-time failure until their UI treatment is defined.
- Keep URL state authoritative for shareable filters, sorting, pagination, and selected ticket where feasible.

### 9.2 Component API expectations

- Components accept semantic props (`status="pending"`, `tone="danger"`) rather than raw visual instructions (`color="orange"`).
- Forward refs where focus management or composition requires it.
- Preserve native element semantics; use a `<button>` for actions and an `<a>`/Next `Link` for navigation.
- All reusable interactive components expose accessible names, disabled/busy state, keyboard behavior, and testable state hooks.
- Avoid premature abstraction. Extract a component when a pattern repeats, carries interaction/accessibility behavior, or represents a stable domain concept.

### 9.3 Data and feedback

- Use server-side filtering, sorting, pagination, and authorization for operational datasets.
- Prefer optimistic UI only when rollback is clear and the action is low risk. Otherwise show immediate pending feedback and reconcile with the server response.
- Prevent duplicate submissions with idempotent server behavior as well as UI state.
- Loading and error boundaries should match the affected region; do not blank the whole application for a local update.

### 9.4 Styling

- Use the project's chosen styling system consistently. Map its theme to the semantic tokens in this document.
- Avoid one-off pixel values unless required by content or platform behavior. Document deliberate exceptions.
- Support light mode first. Do not ship an incomplete dark mode; add it only when every token, chart, state, and elevation has been reviewed.

## 10. Accessibility requirements

Target WCAG 2.2 AA.

- Every workflow must be completable with keyboard alone. Focus order follows reading order and `:focus-visible` is prominent on every interactive element.
- Use landmarks, one logical `h1`, sequential headings, semantic lists/tables, and native controls before ARIA.
- Provide a skip link. Announce meaningful asynchronous changes through appropriately scoped live regions.
- Ensure controls have accessible names and form controls have programmatic labels, descriptions, and errors.
- Minimum targets should generally be 24×24 CSS pixels per WCAG 2.2; product controls should normally meet the larger 40×40 or 44×44 guidance stated above.
- Do not use hover-only content or require precision dragging. Provide non-drag alternatives.
- Support 200% zoom without loss of content or operation and text reflow at narrow widths.
- Give charts, icons, attachments, and meaningful imagery text alternatives. Decorative imagery is hidden from assistive technology.
- Test with automated tooling plus keyboard and at least one major screen reader before release of critical workflows.

## 11. Required quality checks

Before considering a UI feature complete, verify:

- It uses existing tokens and shared primitives or explains why a new one is needed.
- Loading, empty, error, success, permission, and long-content states are handled.
- Desktop, tablet, compact/mobile, 200% zoom, and reduced-motion behavior are intentional.
- The complete workflow works by keyboard, including overlays and focus restoration.
- Labels, headings, status, and priority remain understandable without color.
- User actions receive immediate feedback and failed actions offer recovery.
- The employee portal remains simpler than the agent experience.
- No distinctive composition or visual identity has been copied from a reference product.

## 12. Decision protocol

When requirements are unclear, choose the option that improves clarity, accessibility, consistency, and task completion with the least interface complexity. Record any durable new pattern in this document or in a linked component specification. Do not silently introduce competing tokens or interaction patterns.
