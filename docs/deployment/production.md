# Production Deployment

[Docs](../README.md) > [Deployment](./production.md) > Production Deployment

This guide walks through getting Atlas running in production.

If you are looking for release workflow rather than environment setup, see
[Release Process](./release.md).

For Stripe products, discounts, webhooks, and billing env sync, use
[Stripe Billing Setup](./stripe-billing.md).

Atlas supports two production paths:

- `Managed hosted`: deploy the app from `app/` to Vercel, deploy the API to
  Google Cloud Run, and use PostgreSQL for durable data.
- `Docker self-hosted`: run the app, API, and reverse proxy together with
  `compose.yaml`.

Use `Managed hosted` for the Rebuilding America production and staging
environments. It keeps the public app fast on Vercel, puts the API worker on
Cloud Run, and lets GitHub Environments keep staging and production secrets
separate. Use the Docker path only when you are operating your own host.

## Recommended hosted setup

The recommended hosted topology is:

- Vercel for the app
- Google Cloud Run for the API
- PostgreSQL for API data
- GitHub Environments for production and staging deploy secrets

Why this is the recommended path:

- Vercel handles the public app well and gives you easy rollbacks.
- Cloud Run gives the API a production-grade worker surface for MCP, discovery,
  and scheduled jobs.
- PostgreSQL avoids tying trust-critical civic data to a single VM volume.
- Separate GitHub Environments reduce the chance that staging points at
  production URLs or databases.

## Before you start

Make sure you understand these pieces:

- `app/` is the app
- `api/` is the API
- `.env.production` holds your production environment variables. `make setup`
  scaffolds it automatically and generates `ATLAS_AUTH_INTERNAL_SECRET` if it is
  still a placeholder.
- `.env` is the optional local Compose smoke-test environment file
- `compose.yaml` is the canonical Docker setup for both local e2e runs and
  production

Keep these roles in mind:

- Vercel is for the app
- Cloud Run is for the hosted API
- Docker is for local smoke tests and self-hosted deployments
- PostgreSQL is the hosted production database

## Environment files

`make setup` already creates `.env.production` for you. If you need to recreate
it manually:

```bash
cp .env.production.example .env.production
```

Then fill in the real values.

### Deployment

| Variable                        | Required                                                                                  | Description                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATLAS_DEPLOY_MODE`             | Yes for self-hosted or CI-managed deployments                                             | Set to `production` for production and `staging` for staging. Vercel production builds also validate through `VERCEL_ENV=production`, but setting this explicitly keeps every hosted surface on the same contract. Set to `local` only for single-user local operation (disables auth, hides sign-in/account UI). |
| `ATLAS_PUBLIC_URL`              | Yes                                                                                       | The public origin of the Atlas app (e.g., `https://atlas.example.com`). Compiled into the app bundle and used as the base for auth endpoints, API calls, enterprise SSO callback URLs, and OAuth issuer derivation.                                                                                               |
| `ATLAS_API_URL`                 | Yes for hosted deploy smoke                                                               | The canonical Cloudflare-backed Atlas API origin (e.g., `https://api.atlas.example.com`). GitHub Actions uses this for hosted smoke tests so the deploy proves the edge domain, not the raw Cloud Run URL.                                                                                                        |
| `ATLAS_DOCS_URL`                | Yes when `/docs` should proxy to Mintlify on Vercel                                       | Absolute origin of the deployed Mintlify site (for example `https://your-subdomain.mintlify.dev`). Vercel uses this to rewrite `https://atlas.example.com/docs` to the hosted Mintlify docs while keeping the Atlas URL in the browser.                                                                           |
| `ATLAS_SERVER_API_PROXY_TARGET` | Yes when the app service must forward `/api/*` traffic to a separate Atlas API deployment | Absolute Atlas API origin used by the app server proxy routes. In Cloud Run, this can be the internal `atlas-api` service URL. In Vercel, set it to the public Atlas API origin that should serve proxied `/api/*` requests.                                                                                      |
| `PORT`                          | Platform                                                                                  | The container listen port. On managed platforms like Google Cloud Run, bind to the platform-provided port. Do not expose custom HTTP/HTTPS port config.                                                                                                                                                           |

### Auth

| Variable                               | Required                                    | Description                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATLAS_AUTH_INTERNAL_SECRET`           | Yes                                         | Shared secret between the app and API services. Used for trusted app-to-API requests (e.g., API key introspection). `make setup` generates this automatically.                                                                                                                              |
| `ATLAS_AUTH_API_KEY_INTROSPECTION_URL` | Yes when `ATLAS_DEPLOY_MODE` is not `local` | Internal URL Atlas uses to validate API keys from the app server. In a Compose deployment, set this to `http://atlas-web:3000/api/auth/internal/api-key`. In a hosted app deployment, set it to the app's public auth route, such as `https://atlas.example.com/api/auth/internal/api-key`. |
| `ATLAS_AUTH_DB_PATH`                   | Yes                                         | Path to the Better Auth SQLite database. Must point at persistent storage that survives container restarts.                                                                                                                                                                                 |
| `ATLAS_AUTH_ALLOWED_EMAILS`            | No                                          | Comma-separated bootstrap allowlist for first owners and private operator access. Leave this empty only when every allowed operator will enter through an existing workspace membership or a pending invitation.                                                                            |

### OAuth and MCP

| Variable                         | Required                                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ATLAS_AUTH_JWT_AUDIENCES`       | Yes when `ATLAS_DEPLOY_MODE` is not `local` | OAuth audience claim(s) (`aud`) that the API accepts. Put the MCP resource first, e.g. `https://atlas.example.com/mcp`, so MCP `WWW-Authenticate` challenges publish the correct protected-resource metadata URL. Add the REST API resource as a comma-separated additional value when direct API OAuth tokens are accepted, e.g. `https://atlas.example.com/mcp,https://api.atlas.example.com`. Atlas refuses to start in non-local mode without this set.                       |
| `ATLAS_SAML_ALLOWED_ISSUERS`     | Yes when SAML SSO will be used              | Comma-separated allowlist of SAML IdP issuer URLs (matched by URL origin). DNS TXT domain verification only proves an admin owns the email domain, not the issuer URL, so the issuer host must be opted in by Atlas operators. Empty allowlist denies every SAML registration. Example: `https://accounts.google.com,https://login.microsoftonline.com`. The workspace SSO form surfaces this allowlist inline; admins see whether their pasted issuer is accepted before submit. |
| `ATLAS_SAML_SP_PRIVATE_KEY`      | No                                          | PEM-encoded RSA private key used to sign outbound SAML AuthnRequests. When set, new workspace SAML registrations flip `authnRequestsSigned: true`. Existing registrations continue with their stored configuration.                                                                                                                                                                                                                                                               |
| `ATLAS_SAML_SP_PRIVATE_KEY_PASS` | No                                          | Passphrase for `ATLAS_SAML_SP_PRIVATE_KEY` if the key is encrypted.                                                                                                                                                                                                                                                                                                                                                                                                               |

### Email

| Variable                     | Required           | Description                                                    |
| ---------------------------- | ------------------ | -------------------------------------------------------------- |
| `ATLAS_EMAIL_PROVIDER`       | Yes                | `resend` for production, `capture` for local/test delivery.    |
| `ATLAS_EMAIL_FROM`           | Yes                | The sender address Atlas uses for auth and transactional mail. |
| `ATLAS_EMAIL_RESEND_API_KEY` | When using resend  | API key for the Resend email service.                          |
| `ATLAS_EMAIL_CAPTURE_URL`    | When using capture | URL of the local mail capture service (e.g., MailHog).         |

### API runtime

| Variable                                          | Required                | Description                                                                                                                                                                                                   |
| ------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                    | Yes                     | Database URL for the API. Use PostgreSQL for hosted production and staging. Self-hosted Docker deployments may use SQLite only when the database path points at persistent storage.                           |
| `CORS_ORIGINS`                                    | Yes                     | JSON array of origins allowed to call the API (e.g., `["https://atlas.example.com"]`).                                                                                                                        |
| `ENABLE_OPENAPI_SPEC`                             | No                      | Set to `true` to publish `/openapi.json`.                                                                                                                                                                     |
| `ATLAS_ANON_RATE_LIMIT_ENABLED`                   | No                      | Enable anonymous abuse limits at the app proxy and API. Defaults to `true`; keep it enabled in hosted environments.                                                                                           |
| `ATLAS_ANON_RATE_LIMIT_READS_PER_MINUTE`          | No                      | Anonymous public read burst limit per client. Hosted default: `30`.                                                                                                                                           |
| `ATLAS_ANON_RATE_LIMIT_WRITES_PER_MINUTE`         | No                      | Anonymous public write burst limit per client. Hosted default: `10`.                                                                                                                                          |
| `ATLAS_ANON_RATE_LIMIT_TOTAL_PER_HOUR`            | No                      | Sustained anonymous public request limit per client. Hosted default: `120`.                                                                                                                                   |
| `ATLAS_ANON_CREDENTIAL_RATE_LIMIT_PER_MINUTE`     | No                      | Credential-present pre-auth request burst limit per client. Hosted default: `60`. This protects API key introspection and JWT verification from forged credentials.                                           |
| `ATLAS_ANON_CREDENTIAL_RATE_LIMIT_TOTAL_PER_HOUR` | No                      | Sustained credential-present pre-auth request limit per client. Hosted default: `600`.                                                                                                                        |
| `ATLAS_TRUSTED_PROXY_HOPS`                        | No                      | Number of trusted proxy hops when deriving a client IP from unsigned forwarded headers. Hosted default: `1`, but hosted deploys keep unsigned forwarded headers disabled.                                     |
| `ATLAS_TRUST_UNSIGNED_FORWARD_HEADERS`            | No                      | Whether direct API traffic may derive client identity from raw forwarded headers. Hosted default: `false`; keep it false unless a trusted ingress strips client-supplied forwarding headers before Cloud Run. |
| `ATLAS_EDGE_ORIGIN_SECRET`                        | Yes for hosted API edge | Shared secret Cloudflare writes into `X-Atlas-Proxy-Secret` when setting the signed `X-Atlas-Client-IP` origin header. Use a long random value distinct from `ATLAS_AUTH_INTERNAL_SECRET`.                    |
| `ATLAS_MCP_FORM_ELICITATION_ENABLED`              | No                      | Enables MCP form-mode follow-up questions and confirmations. Defaults to `true`; set to `false` to roll back form elicitation while preserving existing non-elicited MCP behavior.                            |
| `ATLAS_MCP_URL_ELICITATION_ENABLED`               | No                      | Enables MCP URL-mode browser handoffs. Defaults to `true`; set to `false` to stop URL-mode requests and return safe direct-Atlas instructions instead.                                                        |
| `ATLAS_MCP_WORKBENCH_HANDOFFS_ENABLED`            | No                      | Enables MCP-originated Workbench write handoffs. Defaults to `true`; set to `false` to block saved-list, coverage-target, and watch handoffs from MCP while leaving read flows available.                     |
| `ANTHROPIC_API_KEY`                               | For discovery           | Required for the discovery pipeline (Claude-powered entity extraction).                                                                                                                                       |
| `SEARCH_API_KEY`                                  | For discovery           | API key for the search provider used during discovery source fetching.                                                                                                                                        |

Use explicit absolute URLs in production.

For the Mintlify deployment path, treat the public surfaces like this:

- `https://<your-atlas-domain>/docs` -> Vercel rewrite to the hosted Mintlify
  site
- `https://<your-atlas-domain>/docs/api` -> generated Scalar REST API reference
  embedded in Mintlify
- `https://<your-atlas-domain>/openapi.json` -> public machine-readable API
  contract
- API-origin `/docs` and `/redoc` -> not served

Do not model public deployment around separate HTTP and HTTPS port environment
variables. For managed platforms such as Google Cloud Run, the correct pattern
is:

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
ATLAS_DEPLOY_MODE=production
ATLAS_PUBLIC_URL=https://atlas.example.com
ATLAS_DOCS_URL=https://your-subdomain.mintlify.dev
ATLAS_SERVER_API_PROXY_TARGET=https://api.atlas.example.com
ATLAS_AUTH_JWT_AUDIENCES=https://atlas.example.com/mcp,https://api.atlas.example.com
```

Atlas targets the unversioned API base at `/api`. If you provide only the
origin, the app will resolve requests under `/api`.

Mintlify’s Vercel subpath flow requires both repo config and dashboard setup:

1. In Mintlify, open **Settings > Deployment > Custom Domain**
2. Turn on **Host at `/docs`**
3. Add your Atlas domain
4. Set `ATLAS_DOCS_URL` in Vercel to the Mintlify deployment origin
   (`https://<subdomain>.mintlify.dev`)

With `ATLAS_DOCS_URL` configured, `app/vercel.ts` rewrites `/docs` and `/docs/*`
to Mintlify while keeping the public Atlas URL in place. With
`ATLAS_SERVER_API_PROXY_TARGET` configured, `app/vercel.ts` rewrites `/mcp`
directly to the API origin, while the app's server routes proxy public `/api/*`
traffic and `/openapi.json` to the Atlas API deployment.

Set these auth values in Vercel as well:

- `ATLAS_AUTH_API_KEY_INTROSPECTION_URL=https://atlas.example.com/api/auth/internal/api-key`
- `ATLAS_AUTH_INTERNAL_SECRET=<same shared secret used by the API service>`
- `ATLAS_AUTH_ALLOWED_EMAILS=<optional bootstrap allowlist for first owners>`
- `ATLAS_EMAIL_PROVIDER=resend`
- `ATLAS_EMAIL_FROM=Atlas <hello@atlas-mail.example.com>`
- `ATLAS_EMAIL_RESEND_API_KEY=<your Resend API key>`

Use [Email Domain Setup](./email-domain-setup.md) before production cutover so
platform operators verify the sender domain and publish the required DNS records
in advance.

If you are launching team workspaces with enterprise sign-in, the admin setup
entrypoint is:

- `https://<your-atlas-domain>/organization/sso`
- `https://<your-atlas-domain>/sign-in?redirect=/organization/sso` for
  signed-out admins

Use the dedicated SSO provider docs before asking a workspace admin to configure
a provider:

- [Google Workspace OIDC SSO](./google-workspace-oidc-sso.md)
- [Google Workspace SAML SSO](./google-workspace-saml-sso.md)

## GitHub Actions production deploy

Pushes to `main` run `.github/workflows/deploy.yml` after CI passes. The
workflow deploys the API service named `atlas-api`; the public app still ships
through Vercel's GitHub integration.

The deploy job uses the `production` GitHub Environment. Configure these secrets
on that environment, not as shared repository-level secrets, so staging cannot
accidentally inherit production URLs or databases:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT`
- `GCP_REGION`
- `GCP_PROJECT_ID`
- `DATABASE_URL`
- `ANTHROPIC_API_KEY`
- `SEARCH_API_KEY`
- `ATLAS_AUTH_INTERNAL_SECRET`
- `ATLAS_EDGE_ORIGIN_SECRET`
- `ATLAS_AUTH_API_KEY_INTROSPECTION_URL`
- `ATLAS_AUTH_MEMBERSHIP_URL`
- `ATLAS_PUBLIC_URL`
- `ATLAS_API_URL`
- `ATLAS_AUTH_JWT_AUDIENCES`
- `OPENSTATUS_API_KEY` when synthetics should run

Set `ATLAS_AUTH_JWT_AUDIENCES` to the production resource URL list the API
accepts. Put the MCP resource first, for example:

```env
ATLAS_DEPLOY_MODE=production
ATLAS_AUTH_JWT_AUDIENCES=https://atlas.example.com/mcp,https://api.atlas.example.com
ATLAS_AUTH_API_KEY_INTROSPECTION_URL=https://atlas.example.com/api/auth/internal/api-key
ATLAS_AUTH_MEMBERSHIP_URL=https://atlas.example.com
ATLAS_SERVER_API_PROXY_TARGET=https://api.atlas.example.com
```

The first value controls the protected-resource metadata URL Atlas publishes in
MCP OAuth challenges. A wrong or missing value makes compliant clients discover
the wrong authorization metadata, so the workflow and bootstrap deploy path both
require it.

The GitHub Actions deploy path accepts either `ATLAS_API_AUDIENCE` or
`ATLAS_AUTH_JWT_AUDIENCES` for the API audience secret. If the hosted auth
endpoint secrets are omitted, the deploy action derives the production defaults
from `ATLAS_PUBLIC_URL`: `ATLAS_PUBLIC_URL/mcp`,
`ATLAS_PUBLIC_URL/api/auth/internal/api-key`, and `ATLAS_PUBLIC_URL`. Prefer
setting the explicit secrets when the hosted app and API origins diverge.

Set `ATLAS_API_URL` to the canonical Cloudflare-backed API origin, not the raw
Cloud Run service URL. The hosted smoke suite runs with
`ATLAS_HOSTED_EXPECT_EDGE=true` in CI and fails if the API response lacks
Cloudflare headers or if the URL ends in `.run.app`.

`ATLAS_SERVER_API_PROXY_TARGET` must use `https://` in hosted deployments. A
plain `http://` target makes `/mcp` redirect through the API domain before the
MCP client can complete OAuth discovery.

Before changing deploy workflow or hosted auth configuration, run the checks
that parse or exercise the real deploy surfaces:

```bash
actionlint
pnpm run compose:validate
(cd app && pnpm vitest run tests/unit/platform/config/hosted-env.test.ts tests/unit/domains/access/server/runtime.test.ts)
(cd api && uv run pytest tests/platform/test_production_config.py tests/platform/test_mcp_server.py -q)
(cd app && ATLAS_HOSTED_PUBLIC_URL=https://atlas.example.com ATLAS_HOSTED_API_URL=https://api.atlas.example.com pnpm run test:hosted-smoke)
```

### SAML maintenance

These tasks live on the per-provider card under `Organization` →
`Enterprise SSO`; operators do not need to delete and re-register a provider for
any of them.

- **Certificate rotation.** When the IdP rotates its signing key, the workspace
  admin pastes the new PEM into the per-provider `Rotate signing certificate`
  disclosure. Atlas pushes it through Better Auth's `updateSSOProvider` endpoint
  as a partial `samlConfig` patch, so the verified domain, primary marker, and
  SP signing key are preserved.
- **Health check.** The `Run SAML health check` disclosure pings the IdP entry
  point and inspects the stored certificate's expiry without starting a real
  AuthnRequest. Useful as a smoke test before telling end users to sign in.
- **DNS verification.** Atlas auto-polls DNS silently every 30 seconds for up to
  ten minutes after registration. `verifyDomain` performs a real
  `dns.resolveTxt` lookup; the card flips to `Domain verified` as soon as the
  resolver sees the TXT record. Admins can click `Verify domain` to force an
  immediate lookup.

For local or end-to-end runs, use:

- `ATLAS_EMAIL_PROVIDER=capture`
- `ATLAS_EMAIL_CAPTURE_URL=http://127.0.0.1:8025/messages`

Atlas’s auth boundary is now:

- browser sessions manage operator UI access and account/API-key management
- API keys are for direct API calls only
- app-to-API trusted headers use the same API routes as browser traffic; the
  trust boundary comes from auth/session behavior, not a separate host setting

After deploying the app, visit the site and make sure it can load real data from
the API.

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

The fixed `80:80` and `443:443` mappings in `compose.yaml` are a Docker
deployment concern, not part of Atlas’s public application config.

## Docker API for a Vercel app

Use this path if your app is already on Vercel and you only need to run the API
on your VM.

Start the API with:

```bash
cp .env.production.example .env.production
docker compose --env-file .env.production -f compose.yaml up -d --build atlas-api
```

Then:

1. expose the API through your host, reverse proxy, or load balancer
2. point Vercel's `ATLAS_SERVER_API_PROXY_TARGET` at that public API origin
3. redeploy the app if you changed the environment variable

## Cloud Run note

If you deploy Atlas containers to Google Cloud Run, prefer the platform-native
model:

- one container per service
- bind to `PORT`
- let Cloud Run handle HTTPS and public ingress

The Caddy-based Docker stack is for VM-style deployments and production-like
local smoke testing, not a requirement for Cloud Run.

If the app is on Vercel and only the API is on Cloud Run, point Vercel's
`ATLAS_SERVER_API_PROXY_TARGET` at a stable subdomain (e.g.
`https://atlas-api.<your-domain>`) backed by a Cloud Run domain mapping rather
than the raw `*.run.app` URL. The mapping survives service recreations; the raw
URL does not, and any Vercel env that hardcodes it becomes a quiet trap waiting
for the next redeploy.

Cloud Run currently stays deployed with `--ingress=all` and
`--allow-unauthenticated` because the canonical API domain maps directly to the
Cloud Run service; tightening ingress to internal-only or load-balancer-only
would break that domain unless Atlas moves the API behind a Google external load
balancer or another private origin architecture. The raw `*.run.app` URL
therefore remains reachable, but it is not a supported public integration
surface: hosted runtime keeps `ATLAS_TRUST_UNSIGNED_FORWARD_HEADERS=false`, the
API trusts only signed app/edge client identity headers, and the same
anonymous/credential-present middleware buckets protect direct origin traffic.

## API edge protection

Hosted Atlas should keep the API behind the canonical Cloudflare-backed domain,
not a raw `*.run.app` URL. The bootstrap flow is intentionally two-step:

```bash
pnpm bootstrap --api-domain
pnpm bootstrap --api-edge
```

`--api-domain` creates or verifies the Cloud Run domain mapping with a DNS-only
Cloudflare CNAME so the Cloud Run certificate can become healthy. `--api-edge`
then enables the Cloudflare proxy, installs anonymous and credential-present API
rate-limit rules, and installs the signed origin identity header transform.

When bootstrap asks for a Cloudflare API token, create an account-owned token:

1. Open
   `https://dash.cloudflare.com/e34437d6da60fe58537bafc5eb760cfc/api-tokens`.
2. In **Manage account > Account API tokens**, click **Create token**.
3. Set **Token name** to `Atlas Cloudflare API Edge`.
4. In **Permission policies**, choose **Custom**.
5. Set the policy scope to **Specified Domains**.
6. In **Select domains**, choose `rebuildingus.org`.
7. In **DNS & Zones**, select **DNS > Edit** and **Zone > Read**.
8. In **App Security**, select **Zone WAF Rules > Edit**.
9. In **Rules & Configuration**, select **Zone Transform Rules > Edit**.
10. Leave **Client IP Address Filtering** empty unless this setup needs a locked
    operator IP.
11. Click **Continue to summary**, create the token, and paste the token value
    into bootstrap. Cloudflare shows the value once.

For staging, add `--target staging` to both commands. For read-only checks:

```bash
pnpm bootstrap --api-domain --doctor
pnpm bootstrap --api-edge --doctor
```

See [Anonymous API Rate Limits Runbook](../runbooks/rate-limits.md) for the
Cloudflare rule names, incident response, and opt-in hosted rate-limit smoke
test.

To intentionally exercise the hosted anonymous throttle after edge protection is
enabled:

```bash
(cd app && ATLAS_HOSTED_EXPECT_RATE_LIMIT=true ATLAS_HOSTED_PUBLIC_URL=https://atlas.rebuildingus.org ATLAS_HOSTED_API_URL=https://atlas-api.rebuildingus.org pnpm run test:hosted-smoke)
```

Add `ATLAS_HOSTED_EXPECT_EDGE=true` to require Cloudflare response headers in
the hosted smoke suite.

## Verification checklist

After every deployment, check these in order:

1. `GET /health` returns `200`
2. the app loads and can list entities
3. an entity detail page loads correctly
4. magic-link sign-in succeeds
5. passkey sign-in succeeds after a passkey is registered
6. API key creation succeeds and direct `X-API-Key` access works
7. `/organization` loads and lets an owner create or manage a workspace
8. `/organization/sso` loads and shows copy-paste enterprise setup values for
   team workspaces
9. if enterprise SSO is enabled, domain verification and a real SP-initiated
   sign-in succeed
10. `GET https://<your-atlas-domain>/.well-known/oauth-protected-resource/mcp`
    returns the MCP protected-resource metadata for the public Atlas origin
11. unauthenticated `POST https://<your-atlas-domain>/mcp` and
    `POST https://<your-atlas-domain>/mcp/` return `401` with a
    `WWW-Authenticate: Bearer ...` challenge and no redirect
12. `(cd app && ATLAS_HOSTED_PUBLIC_URL=https://<your-atlas-domain> ATLAS_HOSTED_API_URL=https://<your-api-health-origin> pnpm run test:hosted-smoke)`
    passes
13. `pnpm bootstrap --api-edge --doctor` reports Cloudflare proxying and
    rate-limit rules as installed
14. creating a discovery run succeeds
15. restarting the API does not lose database data

If one of these fails, fix it before moving to the next release. This checklist
is meant to catch the most common “deployment succeeded but the app is not
actually usable” problems.

## Backups

Hosted production and staging should use managed PostgreSQL backups. Self-hosted
Docker deployments that use SQLite must keep the database files on the
`atlas-data` volume or another mounted disk. Do not keep Atlas content data or
the Better Auth DB inside the container filesystem.

At minimum, do these three things:

1. copy, snapshot, or export the database on a schedule
2. store backups somewhere other than the service host itself
3. test a restore into a fresh `atlas-data` volume

If you skip the restore test, you do not really know whether your backup is
useful.
