# FixxFlow

FixxFlow is built with Next.js, React, TypeScript, and Supabase.

## Local development

1. Install Node.js 22 or later.
2. Copy `.env.example` to `.env.local` and add the project URL and publishable key from the Supabase Connect dialog.
3. Install packages with `npm install`.
4. Start the app with `npm run dev`.

## Project structure

- `src/app` — Next.js routes, layouts, and route handlers
- `src/components` — reusable interface components
- `src/features` — domain-oriented product modules
- `src/hooks` — shared React hooks
- `src/lib` — infrastructure and service clients
- `src/types` — shared and generated TypeScript types
- `supabase/migrations` — versioned database schema changes
- `supabase/functions` — Supabase Edge Functions

## Supabase types

With the local Supabase stack running, regenerate database types with:

```sh
npx supabase gen types typescript --local > src/types/database.ts
```

Never expose a Supabase secret or service-role key through a `NEXT_PUBLIC_` variable.

### Ticket categories

Apply `20260925002750_starter_ticket_categories.sql` through the normal migration workflow to seed Account / Access, Computer, Email, Network, Printer, Software, Security, Phone, and Other. New organizations receive these nine categories automatically. Existing organizations receive missing defaults; custom and legacy categories (including Hardware and Access), inactive settings, and ticket references are preserved.

Employees can optionally choose a category when requesting support. Staff can categorize tickets on creation and in ticket details. Subcategories appear only when configured beneath the selected category; changing the parent clears the child selection. Existing inactive classifications remain visible on historical tickets.

Later phase: administrator-managed Category → Subcategory → Issue Type. Keep tenant-scoped IDs and parent-child constraints for analytics and automation; archive used values instead of deleting history. Category and Subcategory tables exist today. The Issue Type model, administrator editor, and analytics/automation rules are future work.
