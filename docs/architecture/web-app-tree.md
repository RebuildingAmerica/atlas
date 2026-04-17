# Web App Dependency Tree

This is the current runtime and build dependency tree for Atlas's web app.

## Build Graph

1. `//#openapi`
   - exports `openapi/atlas.openapi.json` from FastAPI
2. `app#api-client`
   - generates `app/src/lib/generated/atlas.ts` from the OpenAPI artifact
3. `app#openapi:lint`
   - lints `openapi/atlas.openapi.json` with Spectral
4. `app#quality`
   - runs app `typecheck`, `lint`, `format:check`
5. `//#api:test`
   - runs API pytest
6. `//#contract:test`
   - verifies runtime/exported OpenAPI parity
7. `//#compose:validate`
   - validates the local and production Compose configurations
8. `//#prod:verify`
   - runs the full production readiness graph through Turbo

Run the full graph with `pnpm run verify` from the repo root.

## Runtime Tree

- App shell
  - route modules under `src/routes/`
  - shared UI in `src/components/`
  - generated route tree in `src/routeTree.gen.ts`
  - `routes/__root.tsx`
- Browse flow
  - `routes/browse.tsx`
  - `components/browse/*`
  - `hooks/use-entries.ts`
  - `hooks/use-taxonomy.ts`
  - `lib/api.ts`
  - `lib/generated/atlas.ts`
- Entity detail flow
  - `routes/entries.$entryId.tsx`
  - `components/entries/*`
  - `hooks/use-entries.ts`
  - `hooks/use-taxonomy.ts`
- Discovery flow
  - `routes/discovery.tsx`
  - `hooks/use-discovery.ts`
  - `features/discovery/server/functions.ts`
  - `features/auth/server/session.ts`
- Auth flow
  - `routes/sign-in.tsx`
  - `routes/account.tsx`
  - `routes/api/auth/*`
  - `features/auth/client/*`
  - `features/auth/server/*`
- Shared UI and helpers
  - `components/ui/*`
  - `components/layout/*`
  - `features/browse/*`
  - `lib/env.ts`
  - `lib/orval/fetcher.ts`
