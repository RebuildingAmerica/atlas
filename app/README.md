# Atlas App

React 19 + TanStack Start app for Atlas. The app is the public and workspace-facing product surface: map, browse, source-linked profiles, public workspace directories, account flows, and paid workspace tools.

## Structure

```text
app/
  src/
    routes/
      __root.tsx
      _public.tsx
      _public/
      _workspace.tsx
      _workspace/
      _auth.tsx
      _auth/
      api/
      [.]well-known/
      openapi[.]json.ts
      sitemap[.]xml.ts
    domains/
      access/
      billing/
      catalog/
      discovery/
      workspace/
    platform/
    lib/
      api.ts
      generated/
    routeTree.gen.ts
```

## Route Groups

Atlas uses TanStack Router file-based routing. A leading underscore marks a pathless layout group; it does not appear in the URL.

- `_public` contains open pages such as `/`, `/browse`, `/map`, `/pricing`, `/directories/:orgId`, profile claim and feedback pages, and legal pages.
- `_workspace` contains authenticated workspace pages such as `/home`, `/discovery`, `/feed`, `/lists`, `/briefs`, `/coverage`, `/watching`, and organization settings.
- `_auth` contains sign-in, sign-up, account setup, and invitation acceptance flows.
- `api/` contains TanStack server routes and proxies.
- `[.]well-known/` escapes literal dot-prefixed OAuth metadata paths.

Route params use TanStack file conventions: `$orgId` becomes `:orgId`, and `[.]` renders a literal dot. `src/routeTree.gen.ts` is generated and should not be hand-edited.

## Domain Layout

Most app code lives under `src/domains/`.

- `access`: auth, workspace membership, SSO, API keys, organization settings, and admin access surfaces.
- `billing`: pricing, checkout, package labels, discounts, and Stripe-facing server helpers.
- `catalog`: browse, map, profiles, public directories, profile actions, and public-directory server functions.
- `discovery`: discovery runs, request forms, coverage imports, and research workflow entry points.
- `workspace`: paid workspace pages and server functions for briefs, watches, coverage, quality, and usage summaries.

Shared shell, navigation, legal pages, and cross-domain layout helpers live in `src/platform/`. Generated API types live in `src/lib/generated/`; app-facing API mapping lives in `src/lib/api.ts`.

## Route Authoring Checklist

- Public page: use `_public` unless the route is an API, docs, sitemap, OpenAPI, or well-known metadata route.
- Authenticated workspace page: use `_workspace`.
- Sign-in or auth setup page: use `_auth`.
- New server route: place it under `api/` and keep request/response contracts typed.
- New backend field: update the FastAPI schema, run `pnpm run openapi`, then run `cd app && pnpm run api-client`.
- Never edit `src/routeTree.gen.ts` by hand.

## Commands

```bash
pnpm install

# App only
cd app && pnpm run dev

# Root full stack
pnpm dev

# Quality
cd app && pnpm run typecheck
cd app && pnpm run lint
cd app && pnpm run test:unit
cd app && pnpm run build

# Regenerate TypeScript API client after OpenAPI changes
cd app && pnpm run api-client
```

The root dev command starts the app, API, and mail capture together. App-only development uses the `portless atlas` alias configured by the repo scripts.

## Standards

- Use pnpm only.
- Keep TypeScript strict: no `any`, no `as any`, and no double casting.
- Extract named interfaces instead of inline type shapes.
- Keep loading, empty, and error states plain and user-facing.
- Reuse domain components and server functions before adding new cross-cutting abstractions.
