# Web App Dependency Tree

[Docs](../README.md) > [Architecture](./README.md) > Web App Dependency Tree

This is the current build and runtime dependency map for the Atlas web app.

## Build Graph

1. `pnpm run openapi`
   - exports FastAPI OpenAPI to `openapi/atlas.openapi.json`
   - mirrors the same artifact to `mintlify/openapi/atlas.openapi.json`
2. `cd app && pnpm run api-client`
   - generates `app/src/lib/generated/atlas.ts` from the OpenAPI artifact
3. `cd app && pnpm run typecheck`
   - verifies TypeScript across app source, tests, scripts, and route modules
4. `cd app && pnpm run lint`
   - runs ESLint across `src` and `tests`
5. `cd app && pnpm run test:unit`
   - runs Vitest unit tests
6. `cd app && pnpm run build`
   - builds the TanStack Start/Nitro output in `.output/`
7. `pnpm run contract:test`
   - verifies exported OpenAPI stays in sync with the FastAPI runtime

Production verification is wired through `pnpm run verify`, which calls the
deploy verification script and then fans out through package-owned Turbo tasks.

## Runtime Tree

- App shell
  - `src/routes/__root.tsx`
  - `src/platform/layout/*`
  - `src/routeTree.gen.ts`
- Public discovery
  - `src/routes/_public.tsx`
  - `src/routes/_public/index.tsx`
  - `src/routes/_public/browse.tsx`
  - `src/routes/_public/map.tsx`
  - `src/domains/catalog/pages/*`
  - `src/domains/catalog/components/*`
  - `src/domains/catalog/hooks/*`
- Public profiles and directories
  - `src/routes/_public/entries.$entryId.tsx`
  - `src/routes/_public/directories.$orgId.tsx`
  - `src/routes/_public/claim.$slug.tsx`
  - `src/routes/_public/feedback.$slug.tsx`
  - `src/domains/catalog/server/public-directory.ts`
  - `src/domains/catalog/components/profiles/*`
- Auth flow
  - `src/routes/_auth.tsx`
  - `src/routes/_auth/sign-in.tsx`
  - `src/routes/_auth/sign-up.tsx`
  - `src/routes/_auth/account-setup.tsx`
  - `src/routes/_auth/accept-invitation.$invitationId.tsx`
  - `src/domains/access/server/*`
  - `src/domains/access/components/*`
- Workspace shell
  - `src/routes/_workspace.tsx`
  - `src/platform/layout/app-navigation.ts`
  - `src/domains/access/components/organization/*`
- Workspace research tools
  - `src/routes/_workspace/home.tsx`
  - `src/routes/_workspace/discovery.tsx`
  - `src/routes/_workspace/feed.tsx`
  - `src/routes/_workspace/lists.tsx`
  - `src/routes/_workspace/lists.$id.tsx`
  - `src/routes/_workspace/briefs.tsx`
  - `src/routes/_workspace/briefs.new.tsx`
  - `src/routes/_workspace/briefs.$briefId.tsx`
  - `src/routes/_workspace/coverage.tsx`
  - `src/routes/_workspace/coverage.$targetId.tsx`
  - `src/routes/_workspace/watching.tsx`
  - `src/domains/workspace/pages/*`
  - `src/domains/workspace/server/*`
  - `src/domains/workspace/hooks/*`
- Workspace administration
  - `src/routes/_workspace/organization.tsx`
  - `src/routes/_workspace/organization.index.tsx`
  - `src/routes/_workspace/organization.sso.tsx`
  - `src/routes/_workspace/account.tsx`
  - `src/routes/_workspace/checkout-complete.tsx`
  - `src/domains/access/*`
  - `src/domains/billing/*`
- Server and metadata routes
  - `src/routes/api/*`
  - `src/routes/[.]well-known/*`
  - `src/routes/openapi[.]json.ts`
  - `src/routes/sitemap[.]xml.ts`
  - `src/routes/docs.tsx`
  - `src/routes/docs.$.tsx`

## Shared Contract Points

- Backend schemas are the source of truth for API response shape.
- `openapi/atlas.openapi.json` and `mintlify/openapi/atlas.openapi.json` must
  stay in sync.
- `app/src/lib/generated/atlas.ts` is generated and should not be hand-edited.
- `app/src/lib/api.ts` maps generated API types to app-facing types.
- `app/src/routeTree.gen.ts` is generated and should not be hand-edited.

## Route Group Reminder

The leading underscore in `_public`, `_workspace`, and `_auth` means "pathless
layout group." It is a TanStack Router convention and is not part of the URL.
These groups make the access boundary visible in code while keeping URLs clean
for users.
