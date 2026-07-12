# Release Process

[Docs](../README.md) > [Deployment](./README.md) > Release Process

This document covers how we decide Atlas is ready to release, what to check
before shipping, and what to verify afterward.

Use [Production Deployment](./production.md) and
[Staging Deployment](./staging.md) for environment and hosting details. Use this
document for the release workflow itself.

## Release Readiness

A release is ready only when:

- The intended changes are merged to the release branch or mainline you are
  shipping from
- `make quality` passes locally or in the relevant CI path
- The deployment path is understood for the environment you are using
- The user-facing or operator-facing changes are documented
- Known risks are explicit, not implicit

## Before You Release

Work through these checks:

1. Pull the exact code you intend to release
2. Run the relevant verification commands
   - include `make test-e2e` for auth and protected-route coverage when the
     release touches app auth or deployment
   - if Playwright browsers are not installed yet, run
     `cd app && pnpm exec playwright install chromium` first
   - include `actionlint`, `pnpm run compose:validate`, focused app/API auth
     tests, and the hosted MCP endpoint test when the release touches GitHub
     Actions, Cloud Run, OAuth audience, or staging/production deployment config
3. Confirm environment variables and deployment config are correct
4. Confirm database and auth storage are on persistent volumes where required
5. Read the diff with release eyes:
   - API changes
   - auth changes
   - discovery workflow changes
   - config changes
   - docs changes

## Release Commands And Flow

The exact deployment command depends on the environment, but the release flow
should look like this:

1. Verify the code
   ```bash
   make quality
   ```
2. Build or deploy using the intended environment path
   - staging: push to `main`; `.github/workflows/deploy-staging.yml` deploys
     `atlas-api-staging`, and Vercel deploys the `main` staging app
   - production: create and push a `v*` tag;
     `.github/workflows/deploy-production.yml` deploys `atlas-api` and the
     Vercel production app from that tagged checkout
3. Record the release tag and any known follow-up items

Production release tags should point at a commit that has already passed the
staging lane on `main`:

```bash
git checkout main
git pull --ff-only
git tag vYYYY.MM.DD-N
git push origin vYYYY.MM.DD-N
```

The Deploy Production workflow requires `VERCEL_TOKEN` in the GitHub
`production` environment. GitHub OIDC is used only for Vercel Trusted Sources
during hosted smoke checks. Because Vercel production domain auto-assignment is
off, the workflow explicitly promotes the tagged Vercel deployment after
`vercel deploy --prod`.

Production uses the full CI gate even when the tag only includes a small surface
change. Turbo remote cache and Docker layer cache should make unchanged work
cheap, but release tags do not skip correctness checks.

## Post-Release Verification

After deployment, verify in this order:

1. `GET /health` returns `200`
2. `GET /openapi.json` returns the public API contract
3. `GET /docs` lands on the Mintlify docs site when docs are part of the release
4. The app loads successfully
5. Core browse or entry-detail pages render
6. Magic-link sign-in works if auth is enabled
7. Passkey sign-in works if auth is enabled
8. API key creation and direct `X-API-Key` access work if auth is enabled
9. `/.well-known/oauth-protected-resource/mcp` returns the deployed MCP
   protected-resource metadata
10. unauthenticated `POST /mcp` and `POST /mcp/` return a bearer challenge
    without a redirect
11. Discovery-run creation works if that path is part of the release
12. Restarting the API does not lose persistent data

Do not treat “deployment command succeeded” as the same thing as “Atlas is
healthy.”

## When to stop the release

Pause and fix the issue before continuing if:

- Health checks fail
- The app cannot load real data
- Auth is broken
- Discovery creation fails unexpectedly
- The deployed config differs from what the release assumed

## Related Docs

- [Production Deployment](./production.md)
- [Staging Deployment](./staging.md)
- [Workflow](../development/workflow.md)
- [Code Review](../development/code-review.md)
