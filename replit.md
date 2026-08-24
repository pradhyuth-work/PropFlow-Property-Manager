# PropFlow

PropFlow helps landlords manage properties, tenant assignments, rent payments, and revision reminders in one live workspace.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/propflow/src/App.tsx` — primary workspace UI and interactions
- `artifacts/propflow/src/components/propflow-ui.tsx` — dashboard, setup, ledger, and modal components
- `lib/api-spec/openapi.yaml` — source of truth for the property, flat, payment, dashboard, and activity API
- `lib/db/src/schema/index.ts` — PostgreSQL schema for properties, flats, and payments
- `artifacts/api-server/src/routes/propflow.ts` — API handlers and aggregate queries

## Architecture decisions

- The app uses the workspace PostgreSQL database through Drizzle's shared database package.
- API contracts are generated from OpenAPI and consumed through typed React Query hooks.
- The dashboard's revision alert is derived from an 11-month elapsed lease threshold.
- The frontend keeps the live-sync indicator tied to the health endpoint and invalidates affected query caches after writes.

## Product

Landlords can create properties, assign tenants to units, edit rent, log payments with per-unit history, filter the ledger, monitor collection metrics, and export the visible ledger as CSV.

## User preferences

The user requested a sleek dark-mode property management and rent tracking experience named PropFlow.

## Gotchas

The generated Zod package currently targets Zod 3, so UUID/integer OpenAPI formats must avoid generated `zod.uuid()` and `zod.int()` helpers.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
