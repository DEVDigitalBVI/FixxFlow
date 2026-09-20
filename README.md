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
