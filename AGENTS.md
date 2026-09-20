<!-- BEGIN:nextjs-agent-rules -->

## Next.js version guidance

This project uses a current Next.js version with APIs and conventions that may differ from older versions. Read the relevant guide in `node_modules/next/dist/docs/` before changing framework behavior, and heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Project instructions for Codex

## Design source of truth

For all user-facing implementation, read and follow `DESIGN_SYSTEM.md` before changing UI code. Treat it as the authoritative product design specification. Do not copy any single reference design or imitate macOS; build an original web interface that applies the documented principles.

If an existing implementation conflicts with `DESIGN_SYSTEM.md`, preserve product behavior but bring new work into alignment. When alignment would require a breaking change or a significant redesign outside the requested scope, identify the conflict and ask before expanding the work.

## Implementation expectations

- Reuse existing tokens, primitives, domain components, and interaction patterns before adding new ones.
- Use semantic React/Next.js patterns and native HTML behavior. Keep server and client boundaries deliberate.
- Use semantic props and centralized mappings for ticket status, priority, SLA, and other shared states.
- Implement responsive behavior, keyboard operation, focus handling, reduced motion, accessible names, errors, loading, empty states, and failure recovery as part of the feature—not as follow-up work.
- Never use color as the only cue. Never make a critical action hover-only or drag-only.
- Keep the agent workspace information-dense but orderly; keep the employee portal intentionally simpler.
- Prefer the ticket list as the primary queue. Use contextual detail drawers on suitable screens and full detail routes for deep work and compact screens.
- Add or update tests for meaningful behavior and accessibility. Run the relevant checks before reporting completion.
- Keep changes scoped. Do not introduce a new UI library, icon family, styling system, or competing design tokens without explicit approval.

## UI completion report

When completing a UI task, briefly state:

1. which shared components or tokens were reused or added;
2. which responsive and accessibility behaviors were verified;
3. any deliberate exception to `DESIGN_SYSTEM.md` and why.
