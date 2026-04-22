# Production Deployment

[Docs](../README.md) > [Deployment](./production.md) > Production Deployment

This guide walks through getting Atlas running in production.

If you are looking for release workflow rather than environment setup,
see [Release Process](./release.md).

Atlas supports two production paths:

- `Vercel + Docker`: deploy the app from `app/` to Vercel and run the API from Docker on a small VM.
- `Docker full stack`: run the app, API, and reverse proxy together with `compose.yaml`.

If you are new to deployment, use `Vercel + Docker`. It is the simplest setup to understand and the easiest one to operate alone.

## Recommended low-cost setup

For a single operator, the simplest production topology is:

- Vercel for the app
- one small VM for the API
- SQLite on a persistent volume

Why this is the recommended path:

- Vercel handles the public app well and gives you easy rollbacks.
- A small VM is a better fit for the API because Atlas currently uses SQLite and background-style discovery work.
- This setup is usually cheaper and easier to debug than putting everything on one platform.

## Before you start

Make sure you understand these pieces:

- `app/` is the app
- `api/` is the API
- `.env.production` holds your production environment variables. `make setup` scaffolds it automatically and generates `ATLAS_AUTH_INTERNAL_SECRET` if it is still a placeholder.
- `.env` is the optional local Compose smoke-test environment file
- `compose.yaml` is the canonical Docker setup for both local e2e runs and production

Keep these roles in mind:

- Vercel is for the app
- Docker is for the API or for a full-stack VM-style deployment
- SQLite must live on persistent storage

## Environment files

`make setup` already creates `.env.production` for you. If you need to recreate it manually:

```bash
cp .env.production.example .env.production
```

Then fill in the real values.

### Deployment

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLAS_DEPLOY_MODE` | No | Omit in production. Set to `local` only for single-user local operation (disables auth, hides sign-in/account UI). This is the single setting that controls whether Atlas runs as a hosted multi-user service or a local standalone tool. |
| `ATLAS_PUBLIC_URL` | Yes | The public origin of the Atlas app (e.g., `https://atlas.example.com`). Compiled into the app bundle and used as the base for auth endpoints, API calls, enterprise SSO callback URLs, and OAuth issuer derivation. |
| `ATLAS_DOCS_URL` | Yes when `/docs` should proxy to Mintlify on Vercel | Absolute origin of the deployed Mintlify site (for example `https://your-subdomain.mintlify.dev`). Vercel uses this to rewrite `https://atlas.example.com/docs` to the hosted Mintlify docs while keeping the Atlas URL in the browser. |
| `ATLAS_SERVER_API_PROXY_TARGET` | Yes when the app service must forward `/api/*` traffic to a separate Atlas API deployment | Absolute Atlas API origin used by the app server and hosted rewrites. In Cloud Run, this can be the internal `atlas-api` service URL. In Vercel, set it to the public Atlas API origin that should serve `/api/*`. |
| `PORT` | Platform | The container listen port. On managed platforms like Google Cloud Run, bind to the platform-provided port. Do not expose custom HTTP/HTTPS port config. |

### Auth

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLAS_AUTH_INTERNAL_SECRET` | Yes | Shared secret between the app and API services. Used for trusted app-to-API requests (e.g., API key introspection). `make setup` generates this automatically. |
| `ATLAS_AUTH_API_KEY_INTROSPECTION_URL` | Yes when `ATLAS_DEPLOY_MODE` is not `local` | Internal URL Atlas uses to validate API keys from the app server. In a Compose deployment, set this to `http://atlas-web:3000/api/auth/internal/api-key`. In a hosted app deployment, set it to the app's public auth route, such as `https://atlas.example.com/api/auth/internal/api-key`. |
| `ATLAS_AUTH_DB_PATH` | Yes | Path to the Better Auth SQLite database. Must point at persistent storage that survives container restarts. |
| `ATLAS_AUTH_ALLOWED_EMAILS` | No | Comma-separated bootstrap allowlist for first owners and private operator access. Leave this empty only when every allowed operator will enter through an existing workspace membership or a pending invitation. |

### OAuth and MCP

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLAS_API_AUDIENCE` | Yes | The OAuth audience claim (`aud`) that the API uses to verify JWT access tokens were issued for it. This identifies the *resource server*, not the authorization server. Set it to the API's public URL (e.g., `https://api.atlas.example.com`). Even when the app and API share a domain, keep this separate from `ATLAS_PUBLIC_URL` because they answer different questions and may diverge later. |

### Email

| Variable | Required | Description |
|----------|----------|-------------|
| `ATLAS_EMAIL_PROVIDER` | Yes | `resend` for production, `capture` for local/test delivery. |
| `ATLAS_EMAIL_FROM` | Yes | The sender address Atlas uses for auth and transactional mail. |
| `ATLAS_EMAIL_RESEND_API_KEY` | When using resend | API key for the Resend email service. |
| `ATLAS_EMAIL_CAPTURE_URL` | When using capture | URL of the local mail capture service (e.g., MailHog). |

### API runtime

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite database path for the API. Must point at persistent storage. |
| `CORS_ORIGINS` | Yes | JSON array of origins allowed to call the API (e.g., `["https://atlas.example.com"]`). |
| `ENABLE_OPENAPI_SPEC` | No | Set to `true` to publish `/openapi.json`. |
| `ENABLE_API_DOCS_UI` | No | Set to `true` only when you intentionally want FastAPI’s built-in `/docs` and `/redoc` UIs. For Mintlify-based production docs, leave this `false`. |
| `ANTHROPIC_API_KEY` | For discovery | Required for the discovery pipeline (Claude-powered entity extraction). |
| `SEARCH_API_KEY` | For discovery | API key for the search provider used during discovery source fetching. |

Use explicit absolute URLs in production.

For the Mintlify deployment path, treat the public surfaces like this:

- `https://<your-atlas-domain>/docs` -> Vercel rewrite to the hosted Mintlify site
- `https://<your-atlas-domain>/openapi.json` -> public machine-readable API contract
- FastAPI `/docs` and `/redoc` -> disabled in production unless explicitly re-enabled

Do not model public deployment around separate HTTP and HTTPS port environment variables. For managed platforms such as Google Cloud Run, the correct pattern is:

- the platform injects `PORT`
- the container listens on `PORT`
- TLS is terminated by the platform ingress
- `ATLAS_PUBLIC_URL` remains the only public-origin setting Atlas needs

## Vercel app

Use this section if the app will live on Vercel.

Create a Vercel project with these settings:

- Framework Preset: `TanStack Start`
- Root Directory: `app`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm run build`
- Node Version: `24`

Set these app env values in Vercel:

```env
ATLAS_PUBLIC_URL=https://atlas.example.com
ATLAS_DOCS_URL=https://your-subdomain.mintlify.dev
ATLAS_SERVER_API_PROXY_TARGET=https://api.atlas.example.com
```

Atlas targets the unversioned API base at `/api`. If you provide only the origin, the app will resolve requests under `/api`.

Mintlify’s Vercel subpath flow requires both repo config and dashboard setup:

1. In Mintlify, open **Settings > Deployment > Custom Domain**
2. Turn on **Host at `/docs`**
3. Add your Atlas domain
4. Set `ATLAS_DOCS_URL` in Vercel to the Mintlify deployment origin (`https://<subdomain>.mintlify.dev`)

With `ATLAS_DOCS_URL` configured, `app/vercel.ts` rewrites `/docs` and `/docs/*` to Mintlify while keeping the public Atlas URL in place. With `ATLAS_SERVER_API_PROXY_TARGET` configured, it also rewrites public `/api/*` traffic (except app-owned auth, health, and Stripe webhook routes) and `/openapi.json` to the Atlas API deployment.

Set these auth values in Vercel as well:

- `ATLAS_AUTH_API_KEY_INTROSPECTION_URL=https://atlas.example.com/api/auth/internal/api-key`
- `ATLAS_AUTH_INTERNAL_SECRET=<same shared secret used by the API service>`
- `ATLAS_AUTH_ALLOWED_EMAILS=<optional bootstrap allowlist for first owners>`
- `ATLAS_EMAIL_PROVIDER=resend`
- `ATLAS_EMAIL_FROM=Atlas <noreply@atlas-mail.example.com>`
- `ATLAS_EMAIL_RESEND_API_KEY=<your Resend API key>`

Use [Email Domain Setup](./email-domain-setup.md) before production cutover so
platform operators verify the sender domain and publish the required DNS
records in advance.

If you are launching team workspaces with enterprise sign-in, the admin setup
entrypoint is:

- `https://<your-atlas-domain>/organization/sso`
- `https://<your-atlas-domain>/sign-in?redirect=/organization/sso` for signed-out admins

Use the dedicated setup guides before asking a workspace admin to configure a
provider:

- [Google Workspace OIDC SSO](./google-workspace-oidc-sso.md)
- [Google Workspace SAML SSO](./google-workspace-saml-sso.md)

For local or end-to-end runs, use:

- `ATLAS_EMAIL_PROVIDER=capture`
- `ATLAS_EMAIL_CAPTURE_URL=http://127.0.0.1:8025/messages`

Atlas’s auth boundary is now:

- browser sessions manage operator UI access and account/API-key management
- API keys are for direct API calls only
- app-to-API trusted headers use the same API routes as browser traffic; the trust boundary comes from auth/session behavior, not a separate host setting

After deploying the app, visit the site and make sure it can load real data from the API.

## Docker full stack

Use this path if you want everything to run on one machine.

This setup runs:

- the app
- the API
- a Caddy reverse proxy in front of both

Start it with:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f compose.yaml up -d --build
```

Services:

- `app`: TanStack Start production server
- `api`: FastAPI API
- `caddy`: public reverse proxy on ports `80` and `443`

Caddy sends:

- `/api/auth/*` to the app server for Better Auth
- `/api/*` to the API
- everything else to the app

In this mode, keep `ATLAS_PUBLIC_URL=https://atlas.example.com`.

The fixed `80:80` and `443:443` mappings in `compose.yaml` are a Docker deployment concern, not part of Atlas’s public application config.

## Docker API for a Vercel app

Use this path if your app is already on Vercel and you only need to run the API on your VM.

Start the API with:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f compose.yaml up -d --build atlas-api
```

Then:

1. expose the API through your host, reverse proxy, or load balancer
2. point Vercel’s `ATLAS_PUBLIC_URL` at that public Atlas origin
3. redeploy the app if you changed the environment variable

## Cloud Run note

If you deploy Atlas containers to Google Cloud Run, prefer the platform-native model:

- one container per service
- bind to `PORT`
- let Cloud Run handle HTTPS and public ingress

The Caddy-based Docker stack is for VM-style deployments and production-like local smoke testing, not a requirement for Cloud Run.

## Verification checklist

After every deployment, check these in order:

1. `GET /health` returns `200`
2. the app loads and can list entities
3. an entity detail page loads correctly
4. magic-link sign-in succeeds
5. passkey sign-in succeeds after a passkey is registered
6. API key creation succeeds and direct `X-API-Key` access works
7. `/organization` loads and lets an owner create or manage a workspace
8. `/organization/sso` loads and shows copy-paste enterprise setup values for team workspaces
9. if enterprise SSO is enabled, domain verification and a real SP-initiated sign-in succeed
10. creating a discovery run succeeds
11. restarting the API does not lose SQLite data

If one of these fails, fix it before moving to the next release. This checklist is meant to catch the most common “deployment succeeded but the app is not actually usable” problems.

## Backups

Production SQLite must live on the `atlas-data` volume or another mounted disk. This now includes both Atlas's content DB and the Better Auth DB. Do not keep either inside the container filesystem.

At minimum, do these three things:

1. copy or snapshot the SQLite file on a schedule
2. store backups somewhere other than the VM itself
3. test a restore into a fresh `atlas-data` volume

If you skip the restore test, you do not really know whether your backup is useful.
