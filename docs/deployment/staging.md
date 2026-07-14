# Staging Deployment

[Docs](../README.md) > [Deployment](./README.md) > Staging Deployment

Staging exists so operators can verify hosted auth, MCP metadata, API changes,
and discovery flows before production visitors depend on them.

For Stripe test-mode products, discounts, webhooks, and Vercel Preview env sync,
use [Stripe Billing Setup](./stripe-billing.md).

## What staging owns

The staging API deploy is a GitHub Actions workflow:

- workflow: `.github/workflows/deploy-staging.yml`
- automatic trigger: push to `main`
- manual trigger: **Deploy Staging** > **Run workflow**
- GitHub Environment: `staging`
- Cloud Run service: `atlas-api-staging`
- recommended app domain: `https://atlas-staging.rebuildingus.org`
- recommended API domain: `https://atlas-api-staging.rebuildingus.org`

The workflow runs CI first. CI classifies the changed files and only runs the
staging work that can matter for that change. Docs-only changes do not rebuild
the API image. App-only changes run hosted smoke without rebuilding
`atlas-api-staging`. API and deploy changes build the same `atlas-api` image as
production, deploy the staging API service, and smoke-test the hosted app/API
pair. Vercel owns staging app deployments through its GitHub integration.

Staging does not create or update the production Cloud Scheduler job. Run
discovery in staging deliberately so test data and external API spend stay
controlled.

## Required staging secrets

Use the same secret names as production, but store staging values in the
`staging` GitHub Environment:

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
- `ATLAS_OPERATOR_ALLOWED_EMAILS`

Set `ATLAS_PUBLIC_URL` to the staging app origin. Set `ATLAS_AUTH_JWT_AUDIENCES`
to the staging resource URL list the API accepts, with the MCP resource first:

```env
ATLAS_DEPLOY_MODE=staging
ATLAS_PUBLIC_URL=https://atlas-staging.rebuildingus.org
ATLAS_API_URL=https://atlas-api-staging.rebuildingus.org
ATLAS_AUTH_JWT_AUDIENCES=https://atlas-staging.rebuildingus.org/mcp,https://atlas-api-staging.rebuildingus.org
ATLAS_AUTH_API_KEY_INTROSPECTION_URL=https://atlas-staging.rebuildingus.org/api/auth/internal/api-key
ATLAS_AUTH_MEMBERSHIP_URL=https://atlas-staging.rebuildingus.org
ATLAS_SERVER_API_PROXY_TARGET=https://atlas-api-staging.rebuildingus.org
ATLAS_EDGE_ORIGIN_SECRET=<long random staging edge origin secret>
```

Those values keep OAuth challenges, MCP protected-resource metadata, CORS, and
app-to-API traffic on staging origins. That separation lets someone test sign-in
and MCP access without risking production users or production data.

The GitHub Actions deploy path accepts either `ATLAS_API_AUDIENCE` or
`ATLAS_AUTH_JWT_AUDIENCES` for the API audience secret. If the hosted auth
endpoint secrets are omitted, the deploy action derives staging defaults from
`ATLAS_PUBLIC_URL`: `ATLAS_PUBLIC_URL/mcp`,
`ATLAS_PUBLIC_URL/api/auth/internal/api-key`, and `ATLAS_PUBLIC_URL`. Set the
explicit secrets when staging uses split hosted app and API origins.

## Vercel staging app

Staging uses a Vercel custom environment named `staging`. Vercel builds the
staging app from the `main` branch through environment branch tracking; GitHub
Actions does not push branches or run `vercel deploy` for staging.

Set the Vercel `staging` env vars to the same app/API origins used by the GitHub
`staging` environment:

```env
ATLAS_DEPLOY_MODE=staging
ATLAS_PUBLIC_URL=https://atlas-staging.rebuildingus.org
ATLAS_SERVER_API_PROXY_TARGET=https://atlas-api-staging.rebuildingus.org
ATLAS_AUTH_JWT_AUDIENCES=https://atlas-staging.rebuildingus.org/mcp,https://atlas-api-staging.rebuildingus.org
ATLAS_AUTH_API_KEY_INTROSPECTION_URL=https://atlas-staging.rebuildingus.org/api/auth/internal/api-key
ATLAS_AUTH_INTERNAL_SECRET=<same staging secret used by atlas-api-staging>
ATLAS_PDS_PUBLIC_URL=https://atlas-pds-staging.rebuildingus.org
```

If the staging app proxies docs through Mintlify, set `ATLAS_DOCS_URL` for the
staging app as well.

`ATLAS_PDS_PUBLIC_URL` must be the credential-free public HTTPS origin for the
staging Atlas PDS. Keep its Cloudflare record DNS-only so the PDS edge can
complete its own ACME certificate validation.

The staging app hostname must be available to the Rebuilding America Project
Vercel team and assigned to the Vercel `staging` environment tracking `main`.
Verify that before relying on the workflow:

```bash
pnpm exec vercel domains ls --scope rebuilding-america-project
pnpm exec vercel inspect atlas-staging.rebuildingus.org --scope rebuilding-america-project
pnpm exec vercel api '/v10/projects/prj_v1sY5KyDpC3vIWj11UMUjf4QKjH3/domains/atlas-staging.rebuildingus.org?teamId=team_IA08hNlo8bXnaFX10JyZbNVz' --raw
```

`atlas-staging.rebuildingus.org` must inspect as an `atlas` staging/custom
environment deployment from `main`. If Vercel reports that the team does not own
the domain, transfer or verify the staging hostname in the Rebuilding America
Project Vercel team.

## Deploy staging

Before running the workflow, validate the deploy surfaces locally:

```bash
actionlint
pnpm run compose:validate
(cd app && pnpm vitest run tests/unit/platform/config/hosted-env.test.ts tests/unit/domains/access/server/runtime.test.ts)
(cd api && uv run pytest tests/platform/test_production_config.py tests/platform/test_mcp_server.py -q)
(cd app && ATLAS_HOSTED_PUBLIC_URL=https://atlas-staging.rebuildingus.org ATLAS_HOSTED_API_URL=https://atlas-api-staging.rebuildingus.org ATLAS_HOSTED_PDS_URL=https://atlas-pds-staging.rebuildingus.org pnpm run test:hosted-smoke)
```

The staging deploy workflow uses `ATLAS_API_URL` for hosted smoke checks and
runs with `ATLAS_HOSTED_EXPECT_EDGE=true`, so set it to the canonical
Cloudflare-backed API domain rather than the raw Cloud Run URL.

To intentionally verify hosted anonymous throttling after the edge is enabled:

```bash
(cd app && ATLAS_HOSTED_EXPECT_RATE_LIMIT=true ATLAS_HOSTED_PUBLIC_URL=https://atlas-staging.rebuildingus.org ATLAS_HOSTED_API_URL=https://atlas-api-staging.rebuildingus.org pnpm run test:hosted-smoke)
```

Add `ATLAS_HOSTED_EXPECT_EDGE=true` to require Cloudflare response headers in
the hosted smoke suite.

### Signed-in hosted identity verification

The staging workflow also has a signed-in ATProto identity verification lane for
auth, ATProto, workspace identity, managed PDS, and staging workflow changes.
This lane does not use a developer's browser session. It runs
`pnpm --filter @rebuildingamerica/atlas-app run test:hosted-identity` against
the hosted staging app with a Vercel Trusted Source OIDC header.

The staging app runtime must expose these Vercel environment variables before
the lane can pass:

- `ATLAS_HOSTED_E2E_ENABLED=1`
- `ATLAS_HOSTED_E2E_SECRET=<same value as the GitHub staging environment secret>`
- `ATLAS_ATPROTO_OAUTH_E2E_HARNESS=1`

Do not set those variables in production. The helper route also refuses
`ATLAS_DEPLOY_MODE=production` and `VERCEL_ENV=production`, so production stays
limited to public, non-mutating smoke proof unless a separate production-safe
synthetic tenant is designed.

Then, for a manual staging deploy:

1. Open GitHub Actions.
2. Select **Deploy Staging**.
3. Run the workflow from `main`.
4. Wait for CI and any selected staging jobs to pass.

After the workflow completes, verify:

1. `GET /health` returns `200` on the staging API.
2. `atlas-staging.rebuildingus.org` points at the Vercel staging deployment for
   `main`.
3. The staging app loads data through the staging API proxy.
4. `/.well-known/oauth-protected-resource/mcp` returns staging resource
   metadata.
5. Magic-link or passkey sign-in works in staging.
6. API key creation and direct `X-API-Key` access work in staging.
7. MCP clients discover the staging protected-resource metadata URL.

If staging uses `atlas-api-staging.rebuildingus.org`, configure the domain
mapping with:

```bash
pnpm bootstrap --api-domain --target staging
pnpm bootstrap --api-edge --target staging
```

## Promote to production

After staging passes on `main`, cut a `v*` tag. The production workflow deploys
`atlas-api` and the Vercel production app from that tag. Use
[Release Process](./release.md) for the release checklist.
